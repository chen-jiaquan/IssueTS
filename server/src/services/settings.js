import crypto from 'node:crypto'
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'
import { isSystemAdminRole } from '../middleware/scope.js'

// 系统设置：兼容历史 app_meta 全局值；新增项目维度设置存 system_settings。
// 读取优先级：匹配项目 > ALL > 全局(空数组) > app_meta > 默认值。
export const ISSUE_EXPORT_LIMIT_KEY = 'issue_export_limit'
export const DEFAULT_ISSUE_EXPORT_LIMIT = 0 // 0=不限制
export const DEFAULT_USER_PASSWORD_KEY = 'default_user_password'
export const DEFAULT_USER_PASSWORD = 'Issue@2026' // 人员下推用户时的初始密码（可在系统设置修改）

const SETTING_COLS = 'id, setting_key AS key, projects, value'
const normalizeCodes = (v) => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))].sort()
}
const normalizeProjects = (v) => normalizeCodes(v)
const isAdminActor = (req) => isSystemAdminRole(req?.profile?.role_code, req?.profile?.role)

function assertProjectAccess(scope, codes) {
  if (scope === null || scope === undefined || !codes.length) return
  for (const code of codes) {
    if (code === 'ALL' || !scope.includes(code)) {
      throw new HttpError(403, ERR.SCOPE, `无权访问项目：${code}`)
    }
  }
}

function assertSettingProjectsEditable(req, projects) {
  if (isAdminActor(req)) return
  if (!projects.length || projects.includes('ALL')) {
    throw new HttpError(403, ERR.SCOPE, '非管理员只能维护具体项目的系统设置')
  }
  const scope = req?.scope
  const bad = scope && Array.isArray(scope) ? projects.find((p) => !scope.includes(p)) : null
  if (bad) throw new HttpError(403, ERR.SCOPE, `无权维护项目：${bad}`)
}

function visibleSettingRows(rows, scope, canReadGlobal) {
  // 全局配置（projects 为空）仅管理员及内部服务调用可见；非管理员只能看到 ALL 或具体项目配置。
  const candidates = canReadGlobal ? rows : rows.filter((r) => (r.projects || []).length)
  if (scope === null || scope === undefined) return candidates
  if (!scope.length) return []
  return candidates.filter((r) => {
    const own = r.projects || []
    return own.includes('ALL') || own.some((p) => scope.includes(p))
  })
}

async function validateProjects(projects) {
  const codes = projects.filter((p) => p !== 'ALL')
  if (!codes.length) return projects
  const { rows } = await pool.query("SELECT code FROM projects WHERE status = '已生效' AND code = ANY($1)", [codes])
  if (rows.length !== codes.length) {
    throw new HttpError(400, ERR.VALIDATION, '所属项目编码不存在', [{ field: 'projects' }])
  }
  return projects
}

async function rowsOf(key) {
  const { rows } = await pool.query(
    `SELECT ${SETTING_COLS} FROM system_settings
     WHERE setting_key=$1 OR setting_key LIKE $2 ORDER BY id`, [key, `${key}:%`])
  return rows
}

function pickRow(rows, codes, scope, canReadGlobal) {
  const candidates = visibleSettingRows(rows, scope, canReadGlobal)
  if (codes.length) {
    const exact = candidates.find((r) => (r.projects || []).some((p) => codes.includes(p)))
    if (exact) return exact
  }
  const all = candidates.find((r) => (r.projects || []).includes('ALL'))
  if (all) return all
  if (scope !== null && scope !== undefined) return undefined
  return canReadGlobal ? candidates.find((r) => !(r.projects || []).length) : undefined
}

async function appMetaValue(key) {
  const { rows } = await pool.query('SELECT value FROM app_meta WHERE key=$1', [key])
  return rows[0]?.value
}

async function resolveValue(key, projects, fallback, parse, scope, req) {
  const codes = normalizeCodes(projects)
  assertProjectAccess(scope, codes)
  // 内部服务调用不传 req，保持历史行为；带 req 的接口按角色判断是否能读全局配置。
  const canReadGlobal = !req || isAdminActor(req)
  const row = pickRow(await rowsOf(key), codes, scope, canReadGlobal)
  const raw = row?.value ?? (canReadGlobal && (scope === null || scope === undefined) ? await appMetaValue(key) : undefined)
  return parse(raw, fallback)
}

function parseLimit(raw) {
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_ISSUE_EXPORT_LIMIT
}

function parsePassword(raw) {
  return typeof raw === 'string' && raw.length >= 6 ? raw : DEFAULT_USER_PASSWORD
}

export async function getIssueExportLimit(projects, scope, req) {
  return resolveValue(ISSUE_EXPORT_LIMIT_KEY, projects, DEFAULT_ISSUE_EXPORT_LIMIT, parseLimit, scope, req)
}

export async function getDefaultUserPassword(projects, scope, req) {
  return resolveValue(DEFAULT_USER_PASSWORD_KEY, projects, DEFAULT_USER_PASSWORD, parsePassword, scope, req)
}

export const listSettingItems = async () =>
  (await pool.query(`SELECT ${SETTING_COLS} FROM system_settings ORDER BY setting_key, id`)).rows

async function upsertSetting(req, key, value, projects, id) {
  const normalized = await validateProjects(normalizeProjects(projects))
  assertSettingProjectsEditable(req, normalized)
  const text = String(value)
  if (id) {
    const { rows: found } = await pool.query(
      `SELECT ${SETTING_COLS} FROM system_settings WHERE id=$1`, [id])
    const existing = found[0]
    if (!existing) throw new HttpError(404, ERR.NOT_FOUND, '系统设置不存在')
    if (existing.key !== key && !existing.key.startsWith(`${key}:`)) {
      throw new HttpError(409, ERR.CONFLICT, '设置项类型不匹配', [{ field: 'id' }])
    }
    assertSettingProjectsEditable(req, normalizeProjects(existing.projects))
    const { rows } = await pool.query(
      `UPDATE system_settings SET value=$2, projects=$3::text[], updated_at=now()
       WHERE id=$1 RETURNING ${SETTING_COLS}`,
      [id, text, normalized])
    return rows[0]
  }
  const rows = await rowsOf(key)
  const same = rows.find((r) => [...(r.projects || [])].sort().join('|') === normalized.join('|'))
  if (same) {
    const { rows: updated } = await pool.query(
      `UPDATE system_settings SET value=$2, updated_at=now() WHERE id=$1 RETURNING ${SETTING_COLS}`,
      [same.id, text])
    return updated[0]
  }
  const settingKey = normalized.length ? `${key}:${crypto.randomUUID()}` : `${key}:default`
  const { rows: inserted } = await pool.query(
    `INSERT INTO system_settings(setting_key, projects, value) VALUES ($1,$2::text[],$3)
     RETURNING ${SETTING_COLS}`,
    [settingKey, normalized, text])
  return inserted[0]
}

export const setIssueExportLimit = (value, { projects, id, req } = {}) =>
  upsertSetting(req, ISSUE_EXPORT_LIMIT_KEY, value, projects, id)

export const setDefaultUserPassword = (value, { projects, id, req } = {}) =>
  upsertSetting(req, DEFAULT_USER_PASSWORD_KEY, value, projects, id)
