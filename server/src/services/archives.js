// 档案服务：通用 CRUD + 引用校验（删除前检查，防悬挂引用）
// 错误统一抛 HttpError（40001 校验 / 40901 业务冲突）
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'
import {
  assertProjectsRequired, isSystemAdminRole, SYSTEM_ADMIN_ROLE_CODE, SYSTEM_ADMIN_ROLE_NAME,
} from '../middleware/scope.js'
import { isRegistrationReviewer } from '../middleware/rbac.js'
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
const sameCodes = (a, b) => [...a].sort().join('|') === [...b].sort().join('|')

async function validateProjects(projects) {
  const codes = projects.filter((p) => p !== 'ALL')
  if (!codes.length) return projects
  // 只有已生效的项目才能被引用（申请中/已拒绝的项目不参与下拉与分配）
  const { rows } = await pool.query("SELECT code FROM projects WHERE status = '已生效' AND code = ANY($1)", [codes])
  if (rows.length !== codes.length) {
    throw new HttpError(400, ERR.VALIDATION, '所属项目编码不存在', [{ field: 'projects' }])
  }
  return projects
}

// 项目权限过滤：scope=null（ALL 权限）不过滤；scope 数组可见 projects 与其相交、或标记为 ALL 的档案
// 空数组 projects 不属于任何项目，对 scope 受限用户不可见。返回 { clause, params }，参数占位从 startIdx 开始
function scopeClause(scope, startIdx, alias = '') {
  if (scope === null || scope === undefined) return { clause: '', params: [] }
  const p = alias ? `${alias}.` : ''
  // 空数组：不属于任何项目，对受限用户不可见
  if (!scope.length) return { clause: ' AND FALSE', params: [] }
  // projects 含 ALL 的档案对所有项目可见，与 projectScopeClause 语义一致。
  return {
    clause: ` AND (${p}projects && $${startIdx}::text[] OR ${p}projects @> ARRAY['ALL']::text[])`,
    params: [scope],
  }
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
const PROJECT_COLS = `code, name, note, color, enabled, preset, status, applicant, applied_at,
  reviewed_by, reviewed_at, review_note`
// 默认只返回已生效项目，避免申请中的项目进入业务下拉；档案页通过 includePending 查看全部。
export const listProjects = (scope, includePending = false) => pool.query(
  `SELECT ${PROJECT_COLS} FROM projects WHERE true
   ${includePending ? '' : "AND status = '已生效'"}
   ${scope === null || scope === undefined ? '' : (scope.length ? 'AND code = ANY($1::text[])' : 'AND FALSE')}
   ORDER BY (status = '申请中') DESC, code`, scope && scope.length ? [scope] : []).then((r) => r.rows)
export async function createProject(b) {
  try {
    await pool.query(`INSERT INTO projects(code, name, note, color, enabled, preset, status)
      VALUES ($1,$2,$3,$4,COALESCE($5,true),COALESCE($6,false),'已生效')`,
      [b.code, b.name ?? b.code, b.note, b.color, b.enabled, b.preset])
    return (await pool.query(`SELECT ${PROJECT_COLS} FROM projects WHERE code=$1`, [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updateProject(code, b, req) {
  const existing = (await pool.query('SELECT status FROM projects WHERE code=$1', [code])).rows[0]
  if (!existing) throw new HttpError(404, ERR.NOT_FOUND, '项目不存在')
  if (existing.status !== '已生效') {
    // 未生效项目只能由管理员通过审核接口启用，防止绕过审批流。
    if (b.enabled === true) {
      throw new HttpError(409, ERR.CONFLICT, '请先通过项目审核使其生效', [{ field: 'enabled' }])
    }
    if (!isSystemAdminRole(req?.profile?.role_code, req?.profile?.role)) {
      throw new HttpError(403, ERR.FORBIDDEN, '该项目处于申请中或已拒绝状态，仅管理员可维护', [{ field: 'code' }])
    }
  }
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

// ---------- 项目申请 ----------
// 登录页可匿名提交；写入项目档案但标记为“申请中”，审核前不可用。
export async function submitProjectApplication(b) {
  const code = String(b.code || '').trim()
  const name = String(b.name || '').trim()
  const applicant = String(b.applicant || '').trim()
  const appliedAt = b.applied_at ? new Date(b.applied_at) : new Date()
  if (Number.isNaN(appliedAt.getTime())) {
    throw new HttpError(400, ERR.VALIDATION, '申请时间格式非法', [{ field: 'applied_at' }])
  }
  try {
    await pool.query(
      `INSERT INTO projects(code, name, applicant, applied_at, status, enabled, note)
       VALUES ($1,$2,$3,$4,'申请中',false,NULL)`,
      [code, name, applicant, appliedAt],
    )
    return (await pool.query(
      `SELECT ${PROJECT_COLS} FROM projects WHERE code=$1`, [code])).rows[0]
  } catch (e) {
    if (e.code === UNIQ) {
      throw new HttpError(409, ERR.CONFLICT, '项目编码已存在，请勿重复提交', [{ field: 'code' }])
    }
    throw e.httpStatus ? e : wrap(e)
  }
}

// 仅管理员审核：通过→已生效并启用；拒绝→已拒绝并保持禁用。
export async function reviewProjectApplication(code, b, actor) {
  const current = (await pool.query('SELECT status FROM projects WHERE code=$1', [code])).rows[0]
  if (!current) throw new HttpError(404, ERR.NOT_FOUND, '项目申请不存在')
  if (current.status !== '申请中') {
    throw new HttpError(409, ERR.CONFLICT, '该项目申请已处理，不能重复审核', [{ field: 'code' }])
  }
  const approve = b.approve === true || b.approve === 'true'
  const { rows } = await pool.query(
    `UPDATE projects SET status=$2, enabled=$3, reviewed_by=$4, reviewed_at=now(), review_note=$5
     WHERE code=$1 RETURNING ${PROJECT_COLS}`,
    [code, approve ? '已生效' : '已拒绝', approve, actor?.username || actor?.person || '', b.note || null],
  )
  return rows[0]
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
// 用户姓名（users.person）全局唯一；空姓名允许，避免系统账号互相冲突。
async function assertPersonNameAvailable(person, excludeUserId = null) {
  const name = String(person ?? '').trim()
  if (!name) return
  const { rows } = await pool.query(
    `SELECT id, username FROM users
     WHERE lower(trim(person)) = lower($1) AND ($2::bigint IS NULL OR id <> $2::bigint) LIMIT 1`,
    [name, excludeUserId])
  if (rows.length) {
    throw new HttpError(409, ERR.CONFLICT, `姓名「${name}」已被账号 ${rows[0].username} 使用，不允许重复`, [{ field: 'person' }])
  }
}

async function findPersonnelUser(code) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE personnel_code=$1 OR username=lower($2)
     ORDER BY (personnel_code=$1) DESC, id LIMIT 1`, [code, code])
  return rows[0]
}

async function resolveRoleCode(value) {
  const roleValue = String(value || '').trim() || 'R03'
  const { rows } = await pool.query(
    `SELECT code FROM roles WHERE code=$1 OR name=$1 ORDER BY (code=$1) DESC, code LIMIT 1`, [roleValue])
  if (rows[0]) return rows[0].code
  throw new HttpError(400, ERR.VALIDATION, `岗位「${roleValue}」在角色档案中不存在，无法下推用户`, [{ field: 'role' }])
}

// 人员新增/修改后下推用户：优先按 personnel_code 定位；用户名取人员编码小写；已存在则同步资料，不覆盖用户自改密码
async function syncPersonnelUser(person) {
  const roleCode = await resolveRoleCode(person.role)
  const username = String(person.code).toLowerCase()
  const existing = await findPersonnelUser(person.code)
  const base = {
    person: person.name,
    personnel_code: person.code,
    role_code: roleCode,
    status: '启用',
    projects: Array.isArray(person.projects) ? person.projects : [],
  }
  if (existing) {
    await updateUser(existing.id, base, null, { fromPersonnel: true })
    return
  }
  await createUser({ username, password: await getDefaultUserPassword(base.projects), ...base }, null, { fromPersonnel: true })
}

export const PERSONNEL_COLS = `code, name, role, "group", color, projects, enabled, preset,
  status, applied_at, reviewed_by, reviewed_at, review_note`
const PERSONNEL_SELECT = `p.code, p.name, p.role, r.name AS role_name, p."group", p.color, p.projects, p.enabled, p.preset,
  p.status, p.applied_at, p.reviewed_by, p.reviewed_at, p.review_note`
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

export async function createPersonnel(b, req, options = {}) {
  if (b.role !== undefined) {
    const roleCode = await resolveRoleCode(b.role)
    // 仅系统管理员角色可把人员岗位设为管理员，防止下推产生管理员账号。
    if (isSystemAdminRole(roleCode) && !isSystemAdminRole(req?.profile?.role_code, req?.profile?.role)) {
      throw new HttpError(409, ERR.CONFLICT, '仅系统管理员角色可将人员岗位设为管理员', [{ field: 'role' }])
    }
  }
  await assertPersonNameAvailable(b.name)
  const projects = await validateProjects(normalizeProjects(b.projects))
  const status = b.status ?? '已生效'
  try {
    const { rows } = await pool.query(
      `INSERT INTO personnel(code, name, role, "group", color, projects, enabled, preset, status, applied_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true),COALESCE($8,false),$9,$10)
       RETURNING ${PERSONNEL_COLS}`,
      [b.code, b.name, b.role, b.group, b.color, JSON.stringify(projects),
        b.enabled, b.preset, status, b.applied_at ?? null],
    )
    // 注册申请只写人员档案，待审核通过后才下推用户账号。
    if (!options.skipUserSync && status === '已生效') await syncPersonnelUser(rows[0])
    return rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}

export async function updatePersonnel(code, b, req) {
  if (b.role !== undefined) {
    const roleCode = await resolveRoleCode(b.role)
    // 仅系统管理员角色可把人员岗位设为管理员，防止下推产生管理员账号。
    if (isSystemAdminRole(roleCode) && !isSystemAdminRole(req?.profile?.role_code, req?.profile?.role)) {
      throw new HttpError(409, ERR.CONFLICT, '仅系统管理员角色可将人员岗位设为管理员', [{ field: 'role' }])
    }
  }
  const current = (await pool.query('SELECT name, status FROM personnel WHERE code=$1', [code])).rows[0]
  if (!current) throw new HttpError(404, ERR.NOT_FOUND, '人员不存在')
  if (current.status !== '已生效') {
    // 待审核记录不能直接启用或由非审核人编辑，防止绕过注册审批。
    if (b.enabled === true) {
      throw new HttpError(409, ERR.CONFLICT, '请先审核该注册申请', [{ field: 'enabled' }])
    }
    if (!isRegistrationReviewer(req?.profile)) {
      throw new HttpError(403, ERR.FORBIDDEN, '该注册申请待审核，仅项目经理或管理员可维护', [{ field: 'code' }])
    }
  }
  const linkedUser = await findPersonnelUser(code)
  await assertPersonNameAvailable(b.name ?? current.name, linkedUser?.id ?? null)
  const projects = b.projects === undefined ? null : JSON.stringify(await validateProjects(normalizeProjects(b.projects)))
  const { rows } = await pool.query(
    `UPDATE personnel SET name=COALESCE($2,name), role=COALESCE($3,role), "group"=COALESCE($4,"group"),
       color=COALESCE($5,color), projects=COALESCE($6,projects), enabled=COALESCE($7,enabled),
       preset=COALESCE($8,preset)
     WHERE code=$1 RETURNING ${PERSONNEL_COLS}`,
    [code, b.name, b.role, b.group, b.color, projects, b.enabled, b.preset],
  )
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '人员不存在')
  // 未生效的注册记录不触发账号下推，审核接口是唯一生成用户的入口。
  if (rows[0].status === '已生效') await syncPersonnelUser(rows[0])
  return rows[0]
}

// 注册审核通过后，按人员档案生成/更新登录账号。
export async function activatePersonnel(code) {
  const person = (await pool.query(
    `SELECT ${PERSONNEL_COLS} FROM personnel WHERE code=$1`, [code])).rows[0]
  if (!person) throw new HttpError(404, ERR.NOT_FOUND, '人员不存在')
  await syncPersonnelUser(person)
  return person
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
async function assertDictItemWritable(id, action) {
  const { rows } = await pool.query('SELECT preset FROM dict_items WHERE id=$1', [id])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '字典项不存在')
  if (rows[0].preset) throw new HttpError(409, ERR.CONFLICT, `系统预置字典项不允许${action}`)
}
const SYSTEM_PRESET_DICT_KEYS = ['customer_test', 'priority', 'status', 'pending_test']

export async function createDictItem(b) {
  await validateDictProject(b.project_code)
  // 系统预置字典的新增项同样按预置保护。
  const preset = SYSTEM_PRESET_DICT_KEYS.includes(b.dict_key) || !!b.preset
  try {
    const { rows } = await pool.query(
      `INSERT INTO dict_items(dict_key, value, label, color, note, product_code, project_code, sort, enabled, preset)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,''),COALESCE($8,0),COALESCE($9,true),$10)
       RETURNING ${DICT_COLS}`,
      [b.dict_key, b.value, b.label || b.value, b.color, b.note, b.product_code, b.project_code, b.sort, b.enabled, preset])
    return rows[0]
  } catch (e) { wrap(e) }
}
export async function updateDictItem(id, b) {
  await assertDictItemWritable(id, '编辑')
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
  await assertDictItemWritable(id, '删除')
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
  assertProjectsRequired(req, projects)
  try {
    await pool.query(
      `INSERT INTO roles(code, name, "desc", external, color, preset, projects)
       VALUES ($1,$2,$3,COALESCE($4,false),$5,COALESCE($6,false),$7::text[])`,
      [b.code, b.name, b.desc, b.external, b.color, b.preset, projects])
    return (await pool.query(`SELECT ${ROLE_COLS} FROM roles WHERE code=$1`, [b.code])).rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}
export async function updateRole(code, b, req) {
  const existing = (await pool.query('SELECT name, projects, preset FROM roles WHERE code=$1', [code])).rows[0]
  if (!existing) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
  if (existing.preset) throw new HttpError(409, ERR.CONFLICT, '系统预置角色不允许编辑', [{ field: 'code' }])
  const projects = b.projects === undefined
    ? existing.projects
    : await validateProjects(normalizeProjects(b.projects))
  assertProjectsRequired(req, projects)
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
  const found = (await pool.query('SELECT preset FROM roles WHERE code=$1', [code])).rows[0]
  if (!found) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
  if (found.preset) throw new HttpError(409, ERR.CONFLICT, '系统预置角色不允许删除', [{ field: 'code' }])
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE role_code=$1', [code])
  if (rows[0].n > 0) throw new HttpError(409, ERR.CONFLICT, `有 ${rows[0].n} 个账号使用该角色，禁止删除`)
  const { rowCount } = await pool.query('DELETE FROM roles WHERE code=$1', [code])
  if (!rowCount) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
}

const PERMISSION_COLS = 'code, module, name, "desc", allow, no_assign'
export const listPermissions = () => pool.query(`SELECT ${PERMISSION_COLS} FROM permissions ORDER BY code`).then((r) => r.rows)
export async function createPermission(b) {
  try {
    await pool.query(
      `INSERT INTO permissions(code, module, name, "desc", allow, no_assign)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,false))`,
      [b.code, b.module, b.name, b.desc, b.allow ? JSON.stringify(b.allow) : null, b.no_assign])
    return (await pool.query(`SELECT ${PERMISSION_COLS} FROM permissions WHERE code=$1`, [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updatePermission(code, b) {
  const { rows } = await pool.query(
    `UPDATE permissions SET module=COALESCE($2,module), name=COALESCE($3,name), "desc"=COALESCE($4,"desc"),
       no_assign=COALESCE($5,no_assign) WHERE code=$1 RETURNING ${PERMISSION_COLS}`,
    [code, b.module, b.name, b.desc, b.no_assign])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '权限不存在')
  // 标记为禁止分配时，清除非管理员角色的历史授权；管理员角色始终拥有全部权限，不受影响。
  if (b.no_assign === true) {
    await pool.query(
      `DELETE FROM role_permissions rp USING roles r
       WHERE rp.role_code = r.code AND rp.perm_code = $1
         AND NOT (r.code = $2 OR r.name = $3)`,
      [code, SYSTEM_ADMIN_ROLE_CODE, SYSTEM_ADMIN_ROLE_NAME])
  }
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
export async function putRolePerms(roleCode, permCodes, actor, scope) {
  const role = await pool.query('SELECT code, name, projects FROM roles WHERE code=$1', [roleCode])
  if (!role.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
  // 项目级权限控制：受限用户（scope 非 null）只能修改其可见项目内、或 ALL 的角色授权。
  if (scope !== null && scope !== undefined) {
    const own = role.rows[0].projects || []
    if (!own.includes('ALL') && !scope.some((c) => own.includes(c))) {
      throw new HttpError(403, ERR.FORBIDDEN, '无权修改该项目的角色权限', [{ field: 'role_code' }])
    }
  }
  // 管理员角色（R01/管理员）的权限仅系统管理员角色可修改，防止绕过界面。
  if (isSystemAdminRole(role.rows[0].code, role.rows[0].name)
      && !isSystemAdminRole(actor?.role_code, actor?.role)) {
    throw new HttpError(403, ERR.FORBIDDEN, '管理员角色的权限仅系统管理员角色可修改', [{ field: 'role_code' }])
  }
  // 禁止分配的权限不得写入非管理员角色，防止绕过界面勾选；管理员角色始终拥有全部权限，不受限制。
  const targetIsAdmin = isSystemAdminRole(role.rows[0].code, role.rows[0].name)
  if (!targetIsAdmin && permCodes.length) {
    const { rows: blocked } = await pool.query(
      'SELECT code FROM permissions WHERE no_assign=true AND code = ANY($1::text[])', [permCodes])
    if (blocked.length) {
      throw new HttpError(409, ERR.CONFLICT, '以下权限禁止分配：' + blocked.map((x) => x.code).join('、'),
        [{ field: 'perm_codes' }])
    }
  }
  // 管理员角色始终拥有全部权限：写入时强制补齐所有禁止分配的权限，
  // 避免界面过滤掉这些权限后保存导致管理员反而失去授权。
  let finalCodes = permCodes
  if (targetIsAdmin) {
    const { rows: forced } = await pool.query('SELECT code FROM permissions WHERE no_assign=true')
    finalCodes = [...new Set([...permCodes, ...forced.map((r) => r.code)])]
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM role_permissions WHERE role_code=$1', [roleCode])
    for (const pc of finalCodes) {
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
  return getRolePerms(scope)
}

// ---------- 用户 ----------
import bcrypt from 'bcryptjs'
const internalActor = { scope: null, profile: { role_code: SYSTEM_ADMIN_ROLE_CODE, role: SYSTEM_ADMIN_ROLE_NAME } }

export async function listUsers(scope, project, req) {
  const params = []
  let where = ''
  // 内置 admin 账号仅系统管理员可见；其他角色即使有用户管理页签权限也不展示该账号。
  if (!isSystemAdminRole(req?.profile?.role_code, req?.profile?.role)) {
    where += " AND u.username <> 'admin'"
  }
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
    `SELECT u.id, u.username, u.person, u.personnel_code, u.status, u.projects, u.role_code, r.name AS role_name, u.preset
     FROM users u LEFT JOIN roles r ON r.code = u.role_code WHERE true${where} ORDER BY u.id`, params)
  return rows
}
export async function createUser(b, req, options = {}) {
  const role = await pool.query('SELECT code, name FROM roles WHERE code=$1', [b.role_code])
  if (!role.rowCount) throw new HttpError(400, ERR.VALIDATION, '角色编码不存在', [{ field: 'role_code' }])
  // 管理员角色（R01）仅系统预置 admin 账号可用，任何新建账号都不得授予。
  if (b.username !== 'admin' && isSystemAdminRole(role.rows[0].code, role.rows[0].name)) {
    throw new HttpError(409, ERR.CONFLICT, '管理员角色仅系统预置 admin 账号可用', [{ field: 'role_code' }])
  }
  await assertPersonNameAvailable(b.person)
  const projects = await validateProjects(normalizeProjects(b.projects))
  assertProjectsRequired(req ?? internalActor, projects)
  try {
    const { rows } = await pool.query(
      `INSERT INTO users(username, password_hash, person, personnel_code, role_code, status, projects, preset)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'启用'),$7,COALESCE($8,false))
       RETURNING id, username, person, personnel_code, role_code, status, projects, preset`,
      [b.username, bcrypt.hashSync(b.password, 10), b.person ?? null,
        options.fromPersonnel ? (b.personnel_code ?? null) : null,
        b.role_code, b.status, JSON.stringify(projects), b.preset])
    return rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}
export async function updateUser(id, b, req, options = {}) {
  const existing = (await pool.query(
    'SELECT username, person, personnel_code, role_code, projects FROM users WHERE id=$1', [id])).rows[0]
  if (!existing) throw new HttpError(404, ERR.NOT_FOUND, '用户不存在')
  const finalRoleCode = b.role_code ?? existing.role_code
  const role = await pool.query('SELECT code, name FROM roles WHERE code=$1', [finalRoleCode])
  if (!role.rowCount) throw new HttpError(400, ERR.VALIDATION, '角色编码不存在', [{ field: 'role_code' }])
  // 管理员角色（R01）仅系统预置 admin 账号可用；编辑非 admin 用户不得授予。
  if (existing.username !== 'admin' && isSystemAdminRole(role.rows[0].code, role.rows[0].name)) {
    throw new HttpError(409, ERR.CONFLICT, '管理员角色仅系统预置 admin 账号可用', [{ field: 'role_code' }])
  }
  const projects = b.projects === undefined
    ? normalizeProjects(existing.projects)
    : await validateProjects(normalizeProjects(b.projects))
  const finalUsername = b.username ?? existing.username
  const finalPerson = b.person ?? existing.person
  if (existing.username === 'admin' && b.status !== undefined && b.status !== '启用') {
    throw new HttpError(409, ERR.CONFLICT, '内置 admin 账号不允许停用', [{ field: 'status' }])
  }
  if (existing.personnel_code && !options.fromPersonnel) {
    const changed = finalUsername !== existing.username
      || String(finalPerson ?? '') !== String(existing.person ?? '')
      || !sameCodes(projects, normalizeProjects(existing.projects))
    if (changed) {
      throw new HttpError(409, ERR.CONFLICT,
        '该账号由人员档案下推，用户名/姓名/所属项目须在人员档案中修改后同步', [{ field: 'personnel_code' }])
    }
  }
  await assertPersonNameAvailable(finalPerson, id)
  assertProjectsRequired(req ?? internalActor, projects)
  const hash = b.password ? bcrypt.hashSync(b.password, 10) : null
  try {
    const { rows } = await pool.query(
      `UPDATE users SET person=COALESCE($2,person), role_code=COALESCE($3,role_code), status=COALESCE($4,status),
         projects=COALESCE($5,projects), password_hash=COALESCE($6,password_hash), preset=COALESCE($7,preset),
         personnel_code=COALESCE($8,personnel_code)
       WHERE id=$1 RETURNING id, username, person, personnel_code, role_code, status, projects, preset`,
      [id, b.person, b.role_code, b.status, b.projects === undefined ? null : JSON.stringify(projects), hash, b.preset,
        options.fromPersonnel ? (b.personnel_code ?? null) : null])
    if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '用户不存在')
    return rows[0]
  } catch (e) { throw e.httpStatus ? e : wrap(e) }
}
export async function removeUser(id) {
  const found = await pool.query('SELECT username FROM users WHERE id=$1', [id])
  if (!found.rows[0]) throw new HttpError(404, ERR.NOT_FOUND, '用户不存在')
  if (found.rows[0].username === 'admin') {
    throw new HttpError(409, ERR.CONFLICT, '内置 admin 账号不允许删除', [{ field: 'username' }])
  }
  await pool.query('DELETE FROM users WHERE id=$1', [id])
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
// 配置界面读取规则：受限用户仅看到自己可见的项目部分；全局规则保持空数组（只读）
export async function getRequiredFieldRules(scope) {
  const { rows } = await pool.query('SELECT field_key, projects FROM required_fields ORDER BY field_key')
  if (scope === null || scope === undefined) return rows
  const result = []
  for (const r of rows) {
    const projects = r.projects || []
    if (!projects.length || projects.includes('ALL')) {
      result.push({ field_key: r.field_key, projects })
      continue
    }
    const visible = projects.filter((p) => scope.includes(p))
    if (visible.length) result.push({ field_key: r.field_key, projects: visible })
  }
  return result
}
export async function putRequiredFields(fields, req, project) {
  // fields: [{ field_key }]；project 有值时只维护该项目的必填标记，其余规则保持原样
  const scope = req?.scope ?? null
  if (project === 'ALL') throw new HttpError(400, ERR.VALIDATION, '项目过滤不支持 ALL，请使用全局配置')
  if (project) {
    await validateProjects([project])
    if (scope && !scope.includes(project)) throw new HttpError(403, ERR.SCOPE, `无权维护项目：${project}`)
  } else if (scope) {
    throw new HttpError(403, ERR.SCOPE, '受限用户请在项目过滤下维护必填字段')
  }

  const { rows: existingRows } = await pool.query('SELECT field_key, projects FROM required_fields')
  const existing = new Map(existingRows.map((r) => [r.field_key, r.projects || []]))
  const submitted = new Set((fields || []).map((f) => String(f.field_key)))

  if (project) {
    for (const key of submitted) {
      if (!existing.has(key)) {
        existing.set(key, [project])
        continue
      }
      const old = existing.get(key)
      if (!old.length || old.includes('ALL')) {
        throw new HttpError(403, ERR.SCOPE, '全局必填字段请到全局配置中修改')
      }
      existing.set(key, [...old.filter((p) => p !== project), project])
    }
    for (const [key, old] of existing) {
      if (!old.length || old.includes('ALL') || submitted.has(key)) continue
      const remaining = old.filter((p) => p !== project)
      if (remaining.length) existing.set(key, remaining)
      else existing.delete(key)
    }
  } else {
    // 全局配置：只调整全局规则，项目专属规则保持原样
    for (const key of submitted) existing.set(key, [])
    for (const [key, old] of existing) {
      if (!old.length && !submitted.has(key)) existing.delete(key)
    }
  }

  const final = [...existing.entries()]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM required_fields')
    for (const [fieldKey, projects] of final) {
      await client.query('INSERT INTO required_fields(field_key, projects) VALUES ($1,$2::text[]) ON CONFLICT (field_key) DO UPDATE SET projects=EXCLUDED.projects', [fieldKey, projects])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return getRequiredFieldRules(scope)
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
