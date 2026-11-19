// 档案服务：通用 CRUD + 引用校验（删除前检查，防悬挂引用）
// 错误统一抛 HttpError（40001 校验 / 40901 业务冲突）
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'

const UNIQ = '23505' // unique_violation
const FK = '23503'   // foreign_key_violation

function wrap(err, fallbackMsg) {
  if (err.code === UNIQ) throw new HttpError(409, ERR.CONFLICT, '编码或名称已存在')
  if (err.code === FK) throw new HttpError(409, ERR.CONFLICT, '存在关联数据，禁止删除或引用了不存在的编码')
  throw new HttpError(500, ERR.SERVER, fallbackMsg || '数据库操作失败')
}

// ---------- 项目 ----------
export const listProjects = () => pool.query('SELECT code, name, note, color FROM projects ORDER BY code').then((r) => r.rows)
export async function createProject(b) {
  try {
    await pool.query('INSERT INTO projects(code, name, note, color) VALUES ($1,$2,$3,$4)', [b.code, b.name ?? b.code, b.note, b.color])
    return (await pool.query('SELECT code, name, note, color FROM projects WHERE code=$1', [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updateProject(code, b) {
  try {
    const { rows } = await pool.query(
      'UPDATE projects SET name=COALESCE($2,name), note=COALESCE($3,note), color=COALESCE($4,color) WHERE code=$1 RETURNING *',
      [code, b.name, b.note, b.color])
    if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '项目不存在')
    return rows[0]
  } catch (e) { e.httpStatus ? e : wrap(e) }
}
export async function removeProject(code) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM issues WHERE project=$1', [code])
  if (rows[0].n > 0) throw new HttpError(409, ERR.CONFLICT, `该项目下有 ${rows[0].n} 条问题，禁止删除`)
  const { rowCount } = await pool.query('DELETE FROM projects WHERE code=$1', [code])
  if (!rowCount) throw new HttpError(404, ERR.NOT_FOUND, '项目不存在')
}

// ---------- 产品 ----------
export const listProducts = () => pool.query('SELECT code, note, color FROM products ORDER BY code').then((r) => r.rows)
export async function createProduct(b) {
  try {
    await pool.query('INSERT INTO products(code, note, color) VALUES ($1,$2,$3)', [b.code, b.note, b.color])
    return (await pool.query('SELECT code, note, color FROM products WHERE code=$1', [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updateProduct(code, b) {
  const { rows } = await pool.query(
    'UPDATE products SET note=COALESCE($2,note), color=COALESCE($3,color) WHERE code=$1 RETURNING *',
    [code, b.note, b.color])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '产品不存在')
  return rows[0]
}
export async function removeProduct(code) {
  const { rowCount } = await pool.query('DELETE FROM products WHERE code=$1', [code]) // FK: dict_items.product_code
  if (!rowCount) throw new HttpError(404, ERR.NOT_FOUND, '产品不存在')
}

// ---------- 人员 ----------
export const listPersonnel = () => pool.query('SELECT code, name, role, "group", color FROM personnel ORDER BY code').then((r) => r.rows)
export async function createPersonnel(b) {
  try {
    await pool.query('INSERT INTO personnel(code, name, role, "group", color) VALUES ($1,$2,$3,$4,$5)',
      [b.code, b.name, b.role, b.group, b.color])
    return (await pool.query('SELECT code, name, role, "group", color FROM personnel WHERE code=$1', [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updatePersonnel(code, b) {
  const { rows } = await pool.query(
    'UPDATE personnel SET name=COALESCE($2,name), role=COALESCE($3,role), "group"=COALESCE($4,"group"), color=COALESCE($5,color) WHERE code=$1 RETURNING *',
    [code, b.name, b.role, b.group, b.color])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '人员不存在')
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
export const listDictItems = (dictKey) => {
  if (dictKey) {
    return pool.query(
      'SELECT id, dict_key, value, label, color, note, product_code, sort FROM dict_items WHERE dict_key=$1 ORDER BY sort, id',
      [dictKey]).then((r) => r.rows)
  }
  return pool.query(
    'SELECT id, dict_key, value, label, color, note, product_code, sort FROM dict_items ORDER BY dict_key, sort, id').then((r) => r.rows)
}
export async function createDictItem(b) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO dict_items(dict_key, value, label, color, note, product_code, sort) VALUES ($1,$2,COALESCE($3,$2),$4,$5,$6,COALESCE($7,0))
       RETURNING id, dict_key, value, label, color, note, product_code, sort`,
      [b.dict_key, b.value, b.label, b.color, b.note, b.product_code, b.sort])
    return rows[0]
  } catch (e) { wrap(e) }
}
export async function updateDictItem(id, b) {
  const { rows } = await pool.query(
    `UPDATE dict_items SET value=COALESCE($2,value), label=COALESCE($3,label), color=COALESCE($4,color),
       note=COALESCE($5,note), product_code=COALESCE($6,product_code), sort=COALESCE($7,sort)
     WHERE id=$1 RETURNING id, dict_key, value, label, color, note, product_code, sort`,
    [id, b.value, b.label, b.color, b.note, b.product_code, b.sort])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '字典项不存在')
  return rows[0]
}
export const removeDictItem = (id) =>
  pool.query('DELETE FROM dict_items WHERE id=$1', [id]).then((r) => {
    if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '字典项不存在')
  })

// ---------- 角色 / 权限 / 矩阵 ----------
export const listRoles = () => pool.query('SELECT code, name, "desc", external, color FROM roles ORDER BY code').then((r) => r.rows)
export async function createRole(b) {
  try {
    await pool.query('INSERT INTO roles(code, name, "desc", external, color) VALUES ($1,$2,$3,COALESCE($4,false),$5)',
      [b.code, b.name, b.desc, b.external, b.color])
    return (await pool.query('SELECT code, name, "desc", external, color FROM roles WHERE code=$1', [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updateRole(code, b) {
  const { rows } = await pool.query(
    'UPDATE roles SET name=COALESCE($2,name), "desc"=COALESCE($3,"desc"), external=COALESCE($4,external), color=COALESCE($5,color) WHERE code=$1 RETURNING *',
    [code, b.name, b.desc, b.external, b.color])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
  return rows[0]
}
export async function removeRole(code) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE role_code=$1', [code])
  if (rows[0].n > 0) throw new HttpError(409, ERR.CONFLICT, `有 ${rows[0].n} 个账号使用该角色，禁止删除`)
  const { rowCount } = await pool.query('DELETE FROM roles WHERE code=$1', [code])
  if (!rowCount) throw new HttpError(404, ERR.NOT_FOUND, '角色不存在')
}

export const listPermissions = () => pool.query('SELECT code, module, name, "desc", allow FROM permissions ORDER BY code').then((r) => r.rows)
export async function createPermission(b) {
  try {
    await pool.query('INSERT INTO permissions(code, module, name, "desc", allow) VALUES ($1,$2,$3,$4,$5)',
      [b.code, b.module, b.name, b.desc, b.allow ? JSON.stringify(b.allow) : null])
    return (await pool.query('SELECT code, module, name, "desc", allow FROM permissions WHERE code=$1', [b.code])).rows[0]
  } catch (e) { wrap(e) }
}
export async function updatePermission(code, b) {
  const { rows } = await pool.query(
    'UPDATE permissions SET module=COALESCE($2,module), name=COALESCE($3,name), "desc"=COALESCE($4,"desc") WHERE code=$1 RETURNING *',
    [code, b.module, b.name, b.desc])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '权限不存在')
  return rows[0]
}
export async function removePermission(code) {
  const { rowCount } = await pool.query('DELETE FROM permissions WHERE code=$1', [code])
  if (!rowCount) throw new HttpError(404, ERR.NOT_FOUND, '权限不存在')
}

// 权限分配矩阵：GET 全量 / PUT 按角色整体替换
export const getRolePerms = () =>
  pool.query('SELECT role_code, perm_code FROM role_permissions ORDER BY role_code, perm_code').then((r) => r.rows)
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
export async function listUsers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.person, u.status, u.projects, u.role_code, r.name AS role_name
     FROM users u LEFT JOIN roles r ON r.code = u.role_code ORDER BY u.id`)
  return rows
}
export async function createUser(b) {
  const role = await pool.query('SELECT 1 FROM roles WHERE code=$1', [b.role_code])
  if (!role.rowCount) throw new HttpError(400, ERR.VALIDATION, '角色编码不存在', [{ field: 'role_code' }])
  try {
    const { rows } = await pool.query(
      `INSERT INTO users(username, password_hash, person, role_code, status, projects)
       VALUES ($1,$2,$3,$4,COALESCE($5,'启用'),$6) RETURNING id, username, person, role_code, status, projects`,
      [b.username, bcrypt.hashSync(b.password, 10), b.person, b.role_code, b.status, JSON.stringify(b.projects)])
    return rows[0]
  } catch (e) { wrap(e) }
}
export async function updateUser(id, b) {
  const role = await pool.query('SELECT 1 FROM roles WHERE code=$1', [b.role_code])
  if (!role.rowCount) throw new HttpError(400, ERR.VALIDATION, '角色编码不存在', [{ field: 'role_code' }])
  const hash = b.password ? bcrypt.hashSync(b.password, 10) : null
  try {
    const { rows } = await pool.query(
      `UPDATE users SET person=COALESCE($2,person), role_code=COALESCE($3,role_code), status=COALESCE($4,status),
         projects=COALESCE($5,projects), password_hash=COALESCE($6,password_hash)
       WHERE id=$1 RETURNING id, username, person, role_code, status, projects`,
      [id, b.person, b.role_code, b.status, b.projects ? JSON.stringify(b.projects) : null, hash])
    if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '用户不存在')
    return rows[0]
  } catch (e) { e.httpStatus ? e : wrap(e) }
}
export const removeUser = (id) =>
  pool.query('DELETE FROM users WHERE id=$1', [id]).then((r) => {
    if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '用户不存在')
  })

// ---------- 自定义字段 / 必填字段 ----------
export const listCustomFields = () =>
  pool.query('SELECT key, label, type FROM custom_fields ORDER BY key').then((r) => r.rows)
export async function createCustomField(b) {
  const max = await pool.query(`SELECT COALESCE(max(substring(key from '\\d+')::int),0) AS m FROM custom_fields WHERE key ~ '^cf_\\d+$'`)
  const key = `cf_${max.rows[0].m + 1}`
  const { rows } = await pool.query('INSERT INTO custom_fields(key, label, type) VALUES ($1,$2,$3) RETURNING key, label, type',
    [key, b.label, b.type])
  return rows[0]
}
export async function updateCustomField(key, b) {
  const { rows } = await pool.query('UPDATE custom_fields SET label=COALESCE($2,label), type=COALESCE($3,type) WHERE key=$1 RETURNING key, label, type',
    [key, b.label, b.type])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '自定义字段不存在')
  return rows[0]
}
export const removeCustomField = (key) =>
  pool.query('DELETE FROM custom_fields WHERE key=$1', [key]).then((r) => {
    if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '自定义字段不存在')
  })

export const getRequiredFields = () => pool.query('SELECT field_key FROM required_fields').then((r) => r.rows.map((x) => x.field_key))
export async function putRequiredFields(fields) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM required_fields')
    for (const f of fields) await client.query('INSERT INTO required_fields(field_key) VALUES ($1) ON CONFLICT DO NOTHING', [f])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return getRequiredFields()
}

// ---------- 通知类型 / 待办优先级 / 预警规则 ----------
export const listNoticeTypes = () => pool.query('SELECT id, name FROM notice_types ORDER BY id').then((r) => r.rows)
export const createNoticeType = (name) =>
  pool.query('INSERT INTO notice_types(name) VALUES ($1) RETURNING id, name', [name])
    .then((r) => r.rows[0]).catch((e) => wrap(e))
export const updateNoticeType = (id, name) =>
  pool.query('UPDATE notice_types SET name=$2 WHERE id=$1 RETURNING id, name', [id, name])
    .then((r) => { if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '通知类型不存在'); return r.rows[0] }).catch((e) => e.httpStatus ? e : wrap(e))
export const removeNoticeType = (id) =>
  pool.query('DELETE FROM notice_types WHERE id=$1', [id]).then((r) => {
    if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '通知类型不存在') // FK: notices 引用
  })

export const listTodoPrios = () => pool.query('SELECT code, label FROM todo_prios ORDER BY code').then((r) => r.rows)
export const createTodoPrio = (b) =>
  pool.query('INSERT INTO todo_prios(code, label) VALUES ($1,$2) RETURNING code, label', [b.code, b.label])
    .then((r) => r.rows[0]).catch((e) => wrap(e))
export const updateTodoPrio = (code, b) =>
  pool.query('UPDATE todo_prios SET label=COALESCE($2,label) WHERE code=$1 RETURNING code, label', [code, b.label])
    .then((r) => { if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '待办优先级不存在'); return r.rows[0] })
export const removeTodoPrio = (code) =>
  pool.query('DELETE FROM todo_prios WHERE code=$1', [code]).then((r) => {
    if (!r.rowCount) throw new HttpError(404, ERR.NOT_FOUND, '待办优先级不存在')
  })

export const listAlertRules = () => pool.query('SELECT key, enabled, days, label FROM alert_rules ORDER BY key').then((r) => r.rows)
export async function putAlertRule(b) {
  const { rows } = await pool.query('UPDATE alert_rules SET enabled=$2, days=$3 WHERE key=$1 RETURNING key, enabled, days, label',
    [b.key, b.enabled, b.days ?? null])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '预警规则不存在')
  return rows[0]
}
