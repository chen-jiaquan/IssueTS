import crypto from 'node:crypto'
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'
import { assertProjectsEditable } from '../middleware/scope.js'

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

async function validateProjects(projects) {
  const codes = projects.filter((p) => p !== 'ALL')
  if (!codes.length) return projects
  const { rows } = await pool.query('SELECT code FROM projects WHERE code = ANY($1)', [codes])
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

function pickRow(rows, codes) {
  if (codes.length) {
    const exact = rows.find((r) => (r.projects || []).some((p) => codes.includes(p)))
    if (exact) return exact
  }
  const all = rows.find((r) => (r.projects || []).includes('ALL'))
  if (all) return all
  return rows.find((r) => !(r.projects || []).length)
}

async function appMetaValue(key) {
  const { rows } = await pool.query('SELECT value FROM app_meta WHERE key=$1', [key])
  return rows[0]?.value
}

async function resolveValue(key, projects, fallback, parse) {
  const row = pickRow(await rowsOf(key), normalizeCodes(projects))
  const raw = row?.value ?? await appMetaValue(key)
  return parse(raw, fallback)
}

function parseLimit(raw) {
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_ISSUE_EXPORT_LIMIT
}

function parsePassword(raw) {
  return typeof raw === 'string' && raw.length >= 6 ? raw : DEFAULT_USER_PASSWORD
}

export async function getIssueExportLimit(projects) {
  return resolveValue(ISSUE_EXPORT_LIMIT_KEY, projects, DEFAULT_ISSUE_EXPORT_LIMIT, parseLimit)
}

export async function getDefaultUserPassword(projects) {
  return resolveValue(DEFAULT_USER_PASSWORD_KEY, projects, DEFAULT_USER_PASSWORD, parsePassword)
}

export const listSettingItems = async () =>
  (await pool.query(`SELECT ${SETTING_COLS} FROM system_settings ORDER BY setting_key, id`)).rows

async function upsertSetting(req, key, value, projects, id) {
  const normalized = await validateProjects(normalizeProjects(projects))
  assertProjectsEditable(req, normalized)
  const text = String(value)
  if (id) {
    const { rows } = await pool.query(
      `UPDATE system_settings SET value=$2, projects=$3::text[], updated_at=now()
       WHERE id=$1 RETURNING ${SETTING_COLS}`,
      [id, text, normalized])
    if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '系统设置不存在')
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
