// 档案服务：通用 CRUD + 引用校验（删除前检查，防悬挂引用）
// 错误统一抛 HttpError（40001 校验 / 40901 业务冲突）
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'
import { assertProjectsRequired, SYSTEM_ADMIN_ROLE_CODE, SYSTEM_ADMIN_ROLE_NAME } from '../middleware/scope.js'
import { getDefaultUserPassword } from './settings.js'

const UNIQ = '23505' // unique_violation
const FK = '23503'   // foreign_key_violation

function wrap(err, fallbackMsg) {
  if (err.code === UNIQ) throw new HttpError(409, ERR.CONFLICT, '编码或名称已存在')
  if (err.code === FK) throw new HttpError(409, ERR.CONFLICT, '存在关联数据，禁止删除或引用了不存在的编码')
  throw new HttpError(500, ERR.SERVER, fallbackMsg || '数据库操作失败')
}

// ---------- 多选项目通用处理 ----------
const normalizeProjects = (v) =>
  [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))]

// 列表过滤项目：兼容 ?project=A&project=B 与 ?project=A,B
const normalizeProjectFilter = (v) => {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' && v ? v.split(',') : [])
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))]
}

async function validateProjects(projects) {
  const codes = projects.filter((p) => p !== 'ALL')
  if (!codes.length) return projects
  const { rows } = await pool.query('SELECT code FROM projects WHERE code = ANY($1)', [codes])
  if (rows.length !== codes.length) {
    throw new HttpError(400, ERR.VALIDATION, '所属项目编码不存在', [{ field: 'projects' }])
  }
  return projects
}

// 项目权限过滤：scope=null（ALL 权限）不过滤；scope 数组仅可见 projects 与其相交的档案
// 空数组 projects 不属于任何项目，对 scope 受限用户不可见。返回 { clause, params }，参数占位从 startIdx 开始
function scopeClause(scope, startIdx, alias = '') {
  if (scope === null || scope === undefined) return { clause: '', params: [] }
  const p = alias ? `${alias}.` : ''
  // 空数组：不属于任何项目，对受限用户不可见
  if (!scope.length) return { clause: ' AND FALSE', params: [] }
  return { clause: ` AND ${p}projects && $${startIdx}::text[]`, params: [scope] }
}

// 角色/预警等项目过滤：scope 与查询项目均按“命中具体项目或 ALL”匹配
function projectScopeClause(scope, project, startIdx, alias = '') {
  const p = alias ? `${alias}.` : ''
  const clauses = []
  const params = []
  let idx = startIdx
  if (scope !== null && scope !== undefined) {
    if (!scope.length) clauses.push('FALSE')
    else {
      params.push(scope)
      clauses.push(`(${p}projects && $${idx}::text[] OR ${p}projects @> ARRAY['ALL']::text[])`)
      idx += 1
    }
  }
  const codes = normalizeProjectFilter(project)
  if (codes.length) {
    params.push(codes)
    clauses.push(`(${p}projects @> $${idx}::text[] OR ${p}projects @> ARRAY['ALL']::text[])`)
  }
  return { clause: clauses.length ? ` AND ${clauses.map((c) => `(${c})`).join(' AND ')}` : '', params }
}

// ---------- 项目 ----------
const PROJECT_COLS = 'code, name, note, color, enabled, preset'
export const listProjects = (scope) => pool.query(
  `SELECT ${PROJECT_COLS} FROM projects WHERE true
   ${scope === null || scope === undefined ? '' : (scope.length ? 'AND code = ANY($1::text[])' : 'AND FALSE')}
   ORDER BY code`, scope && scope.length ? [scope] : []).then((r) => r.rows)
export async function createProject(b) {
  try {
    await pool.query('INSERT INTO projects(code, name, note, color, enabled, preset) VALUES ($1,$2,$3,$4,COALESCE($5,true),COALESCE($6,false))',
      [b.code, b.name ?? b.code, b.note, b.color, b.enabled, b.preset])
    return (await pool.query(`SELECT ${PROJECT_COLS} FROM projects WHERE code=$1`, [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updateProject(code, b) {
  try {
    const { rows } = await pool.query(
      `UPDATE projects SET name=COALESCE($2,name), note=COALESCE($3,note), color=COALESCE($4,color),
         enabled=COALESCE($5,enabled), preset=COALESCE($6,preset) WHERE code=$1 RETURNING ${PROJECT_COLS}`,
      [code, b.name, b.note, b.color, b.enabled, b.preset])
    if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '项目不存在')
    // 问题表单的项目下拉来自 dict_key='project' 字典项，保持两边状态一致
    if (typeof b.enabled === 'boolean') {
      await pool.query("UPDATE dict_items SET enabled=$1 WHERE dict_key='project' AND value=$2", [b.enabled, code])
    }
    return rows[0]
  } catch (e) { e.httpStatus ? e : wrap(e) }
}
export async function removeProject(code) {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM issues WHERE project=$1)::int AS issues,
            (SELECT count(*) FROM personnel WHERE projects ? $1)::int AS personnel`,
    [code],
  )
  if (rows[0].issues > 0) throw new HttpError(409, ERR.CONFLICT, `该项目下有 ${rows[0].issues} 条问题，禁止删除`)
  if (rows[0].personnel > 0) throw new HttpError(409, ERR.CONFLICT, `该项目下关联 ${rows[0].personnel} 名人员，禁止删除`)
  const { rowCount } = await pool.query('DELETE FROM projects WHERE code=$1', [code])
  if (!rowCount) throw new HttpError(404, ERR.NOT_FOUND, '项目不存在')
}

// ---------- 产品 ----------
const PRODUCT_COLS = 'code, note, color, enabled, preset, projects'
export const listProducts = (scope) => {
  const s = scopeClause(scope, 1)
  return pool.query(`SELECT ${PRODUCT_COLS} FROM products WHERE true${s.clause} ORDER BY code`, s.params).then((r) => r.rows)
}
export async function createProduct(b) {
  const projects = await validateProjects(normalizeProjects(b.projects))
  try {
    await pool.query(`INSERT INTO products(code, note, color, enabled, preset, projects)
      VALUES ($1,$2,$3,COALESCE($4,true),COALESCE($5,false),$6::text[])`,
      [b.code, b.note, b.color, b.enabled, b.preset, projects])
    return (await pool.query(`SELECT ${PRODUCT_COLS} FROM products WHERE code=$1`, [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updateProduct(code, b) {
  const projects = b.projects === undefined ? null : await validateProjects(normalizeProjects(b.projects))
  const { rows } = await pool.query(
    `UPDATE products SET note=COALESCE($2,note), color=COALESCE($3,color), enabled=COALESCE($4,enabled),
       preset=COALESCE($5,preset), projects=COALESCE($6::text[],projects) WHERE code=$1 RETURNING ${PRODUCT_COLS}`,
    [code, b.note, b.color, b.enabled, b.preset, projects])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '产品不存在')
  return rows[0]
}
export async function removeProduct(code) {
  const { rowCount } = await pool.query('DELETE FROM products WHERE code=$1', [code]) // FK: dict_items.product_code
  if (!rowCount) throw new HttpError(404, ERR.NOT_FOUND, '产品不存在')
}

// ---------- 人员 ----------
async function resolveRoleCode(value) {
  const roleValue = String(value || '').trim() || 'R03'
  const { rows } = await pool.query(
    `SELECT code FROM roles WHERE code=$1 OR name=$1 ORDER BY (code=$1) DESC, code LIMIT 1`, [roleValue])
  if (rows[0]) return rows[0].code
  throw new HttpError(400, ERR.VALIDATION, `岗位「${roleValue}」在角色档案中不存在，无法下推用户`, [{ field: 'role' }])
}

// 人员新增/修改后下推用户：用户名取人员编码小写；角色取人员所选岗位；已存在则同步资料，不覆盖用户自改密码
async function syncPersonnelUser(person) {
  const roleCode = await resolveRoleCode(person.role)
  const username = String(person.code).toLowerCase()
  const existing = await pool.query('SELECT id FROM users WHERE username=$1', [username])
  const base = {
    person: person.name,
    role_code: roleCode,
    status: '启用',
    projects: Array.isArray(person.projects) ? person.projects : [],
  }
  if (existing.rows[0]) {
    await updateUser(existing.rows[0].id, base)
    return
  }
  await createUser({ username, password: await getDefaultUserPassword(base.projects), ...base })
}

const PERSONNEL_COLS = 'code, name, role, "group", color, projects, enabled, preset'
const PERSONNEL_SELECT = `p.code, p.name, p.role, r.name AS role_name, p."group", p.color, p.projects, p.enabled, p.preset`
export const listPersonnel = (scope) => {
  let where = '', params = []
  if (scope !== null && scope !== undefined) {
    if (!scope.length) where = 'AND FALSE'
    else { params = [scope]; where = `AND (p.projects ? 'ALL' OR p.projects ?| $1::text[])` }
  }
  return pool.query(
    `SELECT ${PERSONNEL_SELECT} FROM personnel p LEFT JOIN roles r ON r.code = p.role
     WHERE true ${where} ORDER BY p.code`, params).then((r) => r.rows)
}

export async function createPersonnel(b) {
  if (b.role !== undefined) await resolveRoleCode(b.role)
  const projects = await validateProjects(normalizeProjects(b.projects))
  try {
    const { rows } = await pool.query(
      `INSERT INTO personnel(code, name, role, "group", color, projects, enabled, preset)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true),COALESCE($8,false))
       RETURNING ${PERSONNEL_COLS}`,
      [b.code, b.name, b.role, b.group, b.color, JSON.stringify(projects), b.enabled, b.preset],
    )
    await syncPersonnelUser(rows[0])
    return rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}

export async function updatePersonnel(code, b) {
  if (b.role !== undefined) await resolveRoleCode(b.role)
  const projects = b.projects === undefined ? null : JSON.stringify(await validateProjects(normalizeProjects(b.projects)))
  const { rows } = await pool.query(
    `UPDATE personnel SET name=COALESCE($2,name), role=COALESCE($3,role), "group"=COALESCE($4,"group"),
       color=COALESCE($5,color), projects=COALESCE($6,projects), enabled=COALESCE($7,enabled),
       preset=COALESCE($8,preset)
     WHERE code=$1 RETURNING ${PERSONNEL_COLS}`,
    [code, b.name, b.role, b.group, b.color, projects, b.enabled, b.preset],
  )
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '人员不存在')
  await syncPersonnelUser(rows[0])
  return rows[0]
}

export async function removePersonnel(code) {
  const row = (await pool.query('SELECT name FROM personnel WHERE code=$1', [code])).rows[0]
  if (!row) throw new HttpError(404, ERR.NOT_FOUND, '人员不存在')
  const { rows } = await pool.query(
    'SELECT (SELECT count(*) FROM issues WHERE reporter=$1 OR owner=$1 OR developer=$1) AS i, (SELECT count(*) FROM users WHERE person=$1) AS u',
    [row.name])
  if (rows[0].i > 0 || rows[0].u > 0) {
    throw new HttpError(409, ERR.CONFLICT, `人员被问题(${rows[0].i})或账号(${rows[0].u})引用，禁止删除`)
  }
  await pool.query('DELETE FROM personnel WHERE code=$1', [code])
}

// ---------- 字典项 ----------
const DICT_COLS = 'id, dict_key, value, label, color, note, product_code, project_code, sort, enabled, preset'

async function validateDictProject(code) {
  if (!code) return
  const { rows } = await pool.query('SELECT 1 FROM projects WHERE code=$1', [code])
  if (!rows[0]) throw new HttpError(400, ERR.VALIDATION, '归属项目不存在', [{ field: 'project_code' }])
}
export const listDictItems = (dictKey, scope) => {
  // 可见范围：通用项(project_code='')始终可见；专属项仅可见项目匹配；空 scope 只见通用项
  const scoped = scope !== null && scope !== undefined
  const cond = scoped
    ? (scope.length ? `AND (project_code='' OR project_code = ANY($n::text[]))` : `AND project_code=''`)
    : ''
  const withParam = (sql, idx) => scoped && scope.length ? sql.replace('$n', `$${idx}`) : sql
  if (dictKey) {
    const params = scope !== null && scope !== undefined && scope.length ? [dictKey, scope] : [dictKey]
    return pool.query(withParam(
      `SELECT ${DICT_COLS} FROM dict_items WHERE dict_key=$1 ${cond} ORDER BY sort, id`, 2), params)
      .then((r) => r.rows)
  }
  const params = scope !== null && scope !== undefined && scope.length ? [scope] : []
  return pool.query(withParam(
    `SELECT ${DICT_COLS} FROM dict_items WHERE true ${cond} ORDER BY dict_key, sort, id`, 1), params)
    .then((r) => r.rows)
}
export async function createDictItem(b) {
  await validateDictProject(b.project_code)
  try {
    const { rows } = await pool.query(
      `INSERT INTO dict_items(dict_key, value, label, color, note, product_code, project_code, sort, enabled, preset)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,''),COALESCE($8,0),COALESCE($9,true),COALESCE($10,false))
       RETURNING ${DICT_COLS}`,
      [b.dict_key, b.value, b.label || b.value, b.color, b.note, b.product_code, b.project_code, b.sort, b.enabled, b.preset])
    return rows[0]
  } catch (e) { wrap(e) }
}
export async function updateDictItem(id, b) {
  await validateDictProject(b.project_code)
  const { rows } = await pool.query(
    `UPDATE dict_items SET value=COALESCE($2,value), label=COALESCE($3,label), color=COALESCE($4,color),
       note=COALESCE($5,note), product_code=COALESCE($6,product_code), project_code=COALESCE($7,project_code),
       sort=COALESCE($8,sort), enabled=COALESCE($9,enabled), preset=COALESCE($10,preset)
     WHERE id=$1 RETURNING ${DICT_COLS}`,
    [id, b.value, b.label, b.color, b.note, b.product_code, b.project_code, b.sort, b.enabled, b.preset])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '字典项不存在')
  return rows[0]
}
export async function removeDictItem(id) {
  const r = await pool.query('DELETE FROM dict_items WHERE id=$1', [id])
  if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '字典项不存在')
}

// ---------- 角色 / 权限 / 矩阵 ----------
const ROLE_COLS = 'code, name, "desc", external, color, preset, projects'
export function listRoles(scope, project) {
  const f = projectScopeClause(scope, project, 1)
  return pool.query(`SELECT ${ROLE_COLS} FROM roles WHERE true${f.clause} ORDER BY code`, f.params).then((r) => r.rows)
}
export async function createRole(b, req) {
  const projects = await validateProjects(normalizeProjects(b.projects))
  assertProjectsRequired(req, projects, { role_code: b.code, role_name: b.name })
  try {
    await pool.query(
      `INSERT INTO roles(code, name, "desc", external, color, preset, projects)
       VALUES ($1,$2,$3,COALESCE($4,false),$5,COALESCE($6,false),$7::text[])`,
      [b.code, b.name, b.desc, b.external, b.color, b.preset, projects])
    return (await pool.query(`SELECT ${ROLE_COLS} FROM roles WHERE code=$1`, [b.code])).rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}
export async function updateRole(code, b, req) {
  const existing = (await pool.query('SELECT name, projects FROM roles WHERE code=$1', [code])).rows[0]
  if (!existing) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
  const projects = b.projects === undefined
    ? existing.projects
    : await validateProjects(normalizeProjects(b.projects))
  assertProjectsRequired(req, projects, { role_code: code, role_name: b.name ?? existing.name })
  try {
    const { rows } = await pool.query(
      `UPDATE roles SET name=COALESCE($2,name), "desc"=COALESCE($3,"desc"), external=COALESCE($4,external),
         color=COALESCE($5,color), preset=COALESCE($6,preset), projects=COALESCE($7::text[],projects)
       WHERE code=$1 RETURNING ${ROLE_COLS}`,
      [code, b.name, b.desc, b.external, b.color, b.preset, projects])
    if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
    return rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}
export async function removeRole(code) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE role_code=$1', [code])
  if (rows[0].n > 0) throw new HttpError(409, ERR.CONFLICT, `有 ${rows[0].n} 个账号使用该角色，禁止删除`)
  const { rowCount } = await pool.query('DELETE FROM roles WHERE code=$1', [code])
  if (!rowCount) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
}

const PERMISSION_COLS = 'code, module, name, "desc", allow, preset'
export const listPermissions = () => pool.query(`SELECT ${PERMISSION_COLS} FROM permissions ORDER BY code`).then((r) => r.rows)
export async function createPermission(b) {
  try {
    await pool.query('INSERT INTO permissions(code, module, name, "desc", allow, preset) VALUES ($1,$2,$3,$4,$5,COALESCE($6,false))',
      [b.code, b.module, b.name, b.desc, b.allow ? JSON.stringify(b.allow) : null, b.preset])
    return (await pool.query(`SELECT ${PERMISSION_COLS} FROM permissions WHERE code=$1`, [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updatePermission(code, b) {
  const { rows } = await pool.query(
    `UPDATE permissions SET module=COALESCE($2,module), name=COALESCE($3,name), "desc"=COALESCE($4,"desc"),
       preset=COALESCE($5,preset) WHERE code=$1 RETURNING *`,
    [code, b.module, b.name, b.desc, b.preset])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '权限不存在')
  return rows[0]
}
export async function removePermission(code) {
  const { rowCount } = await pool.query('DELETE FROM permissions WHERE code=$1', [code])
  if (!rowCount) throw new HttpError(404, ERR.NOT_FOUND, '权限不存在')
}

// 权限分配矩阵：GET 按角色所属项目过滤 / PUT 按角色整体替换
export function getRolePerms(scope, project) {
  const f = projectScopeClause(scope, project, 1, 'r')
  return pool.query(
    `SELECT rp.role_code, rp.perm_code FROM role_permissions rp
     JOIN roles r ON r.code = rp.role_code WHERE true${f.clause}
     ORDER BY rp.role_code, rp.perm_code`, f.params).then((r) => r.rows)
}
export async function putRolePerms(roleCode, permCodes) {
  const role = await pool.query('SELECT 1 FROM roles WHERE code=$1', [roleCode])
  if (!role.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM role_permissions WHERE role_code=$1', [roleCode])
    for (const pc of permCodes) {
      await client.query('INSERT INTO role_permissions(role_code, perm_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [roleCode, pc])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    if (e.code === FK) throw new HttpError(409, ERR.CONFLICT, '包含不存在的权限编码')
    throw e
  } finally {
    client.release()
  }
  return getRolePerms()
}

// ---------- 用户（SECURITY_MGR） ----------
import bcrypt from 'bcryptjs'
const internalActor = { scope: null, profile: { role_code: SYSTEM_ADMIN_ROLE_CODE, role: SYSTEM_ADMIN_ROLE_NAME } }

export async function listUsers(scope, project) {
  const params = []
  let where = ''
  if (scope !== null && scope !== undefined) {
    if (!scope.length) where += ' AND FALSE'
    else { params.push(scope); where += ` AND (u.projects ? 'ALL' OR u.projects ?| $${params.length}::text[])` }
  }
  const codes = normalizeProjectFilter(project)
  if (codes.length) {
    params.push(codes)
    where += ` AND (u.projects ?| $${params.length}::text[] OR u.projects ? 'ALL')`
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.person, u.status, u.projects, u.role_code, r.name AS role_name, u.preset
     FROM users u LEFT JOIN roles r ON r.code = u.role_code WHERE true${where} ORDER BY u.id`, params)
  return rows
}
export async function createUser(b, req) {
  const role = await pool.query('SELECT code, name FROM roles WHERE code=$1', [b.role_code])
  if (!role.rowCount) throw new HttpError(400, ERR.VALIDATION, '角色编码不存在', [{ field: 'role_code' }])
  const projects = await validateProjects(normalizeProjects(b.projects))
  assertProjectsRequired(req ?? internalActor, projects, role.rows[0])
  try {
    const { rows } = await pool.query(
      `INSERT INTO users(username, password_hash, person, role_code, status, projects, preset)
       VALUES ($1,$2,$3,$4,COALESCE($5,'启用'),$6,COALESCE($7,false))
       RETURNING id, username, person, role_code, status, projects, preset`,
      [b.username, bcrypt.hashSync(b.password, 10), b.person, b.role_code, b.status, JSON.stringify(projects), b.preset])
    return rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}
export async function updateUser(id, b, req) {
  const existing = (await pool.query('SELECT role_code, projects FROM users WHERE id=$1', [id])).rows[0]
  if (!existing) throw new HttpError(404, ERR.NOT_FOUND, '用户不存在')
  const finalRoleCode = b.role_code ?? existing.role_code
  const role = await pool.query('SELECT code, name FROM roles WHERE code=$1', [finalRoleCode])
  if (!role.rowCount) throw new HttpError(400, ERR.VALIDATION, '角色编码不存在', [{ field: 'role_code' }])
  const projects = b.projects === undefined
    ? normalizeProjects(existing.projects)
    : await validateProjects(normalizeProjects(b.projects))
  assertProjectsRequired(req ?? internalActor, projects, role.rows[0])
  const hash = b.password ? bcrypt.hashSync(b.password, 10) : null
  try {
    const { rows } = await pool.query(
      `UPDATE users SET person=COALESCE($2,person), role_code=COALESCE($3,role_code), status=COALESCE($4,status),
         projects=COALESCE($5,projects), password_hash=COALESCE($6,password_hash), preset=COALESCE($7,preset)
       WHERE id=$1 RETURNING id, username, person, role_code, status, projects, preset`,
      [id, b.person, b.role_code, b.status, b.projects === undefined ? null : JSON.stringify(projects), hash, b.preset])
    if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '用户不存在')
    return rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}
export async function removeUser(id) {
  const r = await pool.query('DELETE FROM users WHERE id=$1', [id])
  if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '用户不存在')
}

// ---------- 自定义字段 / 必填字段 ----------
const CUSTOM_COLS = 'key, label, type, enabled, preset, projects'
export const listCustomFields = (scope) => {
  const s = scopeClause(scope, 1)
  return pool.query(`SELECT ${CUSTOM_COLS} FROM custom_fields WHERE true${s.clause} ORDER BY key`, s.params).then((r) => r.rows)
}
export async function createCustomField(b) {
  const max = await pool.query(`SELECT COALESCE(max(substring(key from '\\d+')::int),0) AS m FROM custom_fields WHERE key ~ '^cf_\\d+$'`)
  const key = `cf_${max.rows[0].m + 1}`
  const projects = await validateProjects(normalizeProjects(b.projects))
  const { rows } = await pool.query(
    `INSERT INTO custom_fields(key, label, type, enabled, preset, projects) VALUES ($1,$2,$3,COALESCE($4,true),COALESCE($5,false),$6::text[])
     RETURNING ${CUSTOM_COLS}`,
    [key, b.label, b.type, b.enabled, b.preset, projects])
  return rows[0]
}
export async function updateCustomField(key, b) {
  const projects = b.projects === undefined ? null : await validateProjects(normalizeProjects(b.projects))
  const { rows } = await pool.query(
    `UPDATE custom_fields SET label=COALESCE($2,label), type=COALESCE($3,type), enabled=COALESCE($4,enabled),
       preset=COALESCE($5,preset), projects=COALESCE($6::text[],projects) WHERE key=$1 RETURNING ${CUSTOM_COLS}`,
    [key, b.label, b.type, b.enabled, b.preset, projects])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '自定义字段不存在')
  return rows[0]
}
export async function removeCustomField(key) {
  const r = await pool.query('DELETE FROM custom_fields WHERE key=$1', [key])
  if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '自定义字段不存在')
}

// 必填规则：每条含 field_key + projects（空数组=全局必填）。GET 返回字符串数组供表单校验
export async function getRequiredFields(project) {
  const sql = project
    ? `SELECT field_key FROM required_fields WHERE cardinality(projects)=0 OR projects && $1::text[] ORDER BY field_key`
    : `SELECT field_key FROM required_fields ORDER BY field_key`
  const { rows } = await pool.query(sql, project ? [[project]] : [])
  return rows.map((x) => x.field_key)
}
// 配置界面读取带项目维度的完整规则
export const getRequiredFieldRules = () =>
  pool.query('SELECT field_key, projects FROM required_fields ORDER BY field_key').then((r) => r.rows)
export async function putRequiredFields(fields) {
  // fields: [{ field_key, projects: string[] }]
  const normalized = []
  for (const f of fields) {
    const projects = await validateProjects(normalizeProjects(f.projects))
    normalized.push([String(f.field_key), projects])
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM required_fields')
    for (const [fieldKey, projects] of normalized) {
      await client.query('INSERT INTO required_fields(field_key, projects) VALUES ($1,$2::text[]) ON CONFLICT (field_key) DO UPDATE SET projects=EXCLUDED.projects', [fieldKey, projects])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return getRequiredFieldRules()
}

// ---------- 通知类型 / 待办优先级 / 预警规则 ----------
const NOTICE_COLS = 'id, name, enabled, preset, projects'
export const listNoticeTypes = (scope) => {
  const s = scopeClause(scope, 1)
  return pool.query(`SELECT ${NOTICE_COLS} FROM notice_types WHERE true${s.clause} ORDER BY id`, s.params).then((r) => r.rows)
}
export const createNoticeType = async (b) => {
  const projects = await validateProjects(normalizeProjects(b.projects))
  return pool.query(`INSERT INTO notice_types(name, enabled, preset, projects) VALUES ($1,COALESCE($2,true),COALESCE($3,false),$4::text[]) RETURNING ${NOTICE_COLS}`,
    [b.name, b.enabled, b.preset, projects])
    .then((r) => r.rows[0]).catch((e) => wrap(e))
}
export async function updateNoticeType(id, b) {
  try {
    const projects = b.projects === undefined ? null : await validateProjects(normalizeProjects(b.projects))
    const { rows } = await pool.query(
      `UPDATE notice_types SET name=COALESCE($2,name), enabled=COALESCE($3,enabled), preset=COALESCE($4,preset),
         projects=COALESCE($5::text[],projects) WHERE id=$1 RETURNING ${NOTICE_COLS}`,
      [id, b.name, b.enabled, b.preset, projects])
    if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '通知类型不存在')
    return rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}
export async function removeNoticeType(id) {
  const r = await pool.query('DELETE FROM notice_types WHERE id=$1', [id])
  if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '通知类型不存在') // FK: notices 引用
}

const TODO_COLS = 'code, label, enabled, preset, projects'
export const listTodoPrios = (scope) => {
  const s = scopeClause(scope, 1)
  return pool.query(`SELECT ${TODO_COLS} FROM todo_prios WHERE true${s.clause} ORDER BY code`, s.params).then((r) => r.rows)
}
export const createTodoPrio = async (b) => {
  const projects = await validateProjects(normalizeProjects(b.projects))
  return pool.query(`INSERT INTO todo_prios(code, label, enabled, preset, projects) VALUES ($1,$2,COALESCE($3,true),COALESCE($4,false),$5::text[]) RETURNING ${TODO_COLS}`,
    [b.code, b.label, b.enabled, b.preset, projects])
    .then((r) => r.rows[0]).catch((e) => wrap(e))
}
export async function updateTodoPrio(code, b) {
  const projects = b.projects === undefined ? null : await validateProjects(normalizeProjects(b.projects))
  const { rows } = await pool.query(
    `UPDATE todo_prios SET label=COALESCE($2,label), enabled=COALESCE($3,enabled), preset=COALESCE($4,preset),
       projects=COALESCE($5::text[],projects) WHERE code=$1 RETURNING ${TODO_COLS}`,
    [code, b.label, b.enabled, b.preset, projects])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '待办优先级不存在')
  return rows[0]
}
export async function removeTodoPrio(code) {
  const r = await pool.query('DELETE FROM todo_prios WHERE code=$1', [code])
  if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '待办优先级不存在')
}

const ALERT_COLS = 'key, enabled, days, label, preset, projects'
export const listAlertRules = () =>
  pool.query(`SELECT ${ALERT_COLS} FROM alert_rules ORDER BY key`).then((r) => r.rows)
export async function putAlertRule(b) {
  // 界面不再维护所属项目，未传时保留原值（存量规则为 ALL）。
  const projects = b.projects === undefined ? null : await validateProjects(normalizeProjects(b.projects))
  const { rows } = await pool.query(
    `UPDATE alert_rules SET enabled=$2, days=$3, preset=COALESCE($4,preset), projects=COALESCE($5::text[],projects)
     WHERE key=$1 RETURNING ${ALERT_COLS}`,
    [b.key, b.enabled, b.days ?? null, b.preset, projects])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '预警规则不存在')
  return rows[0]
}
