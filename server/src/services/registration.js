// 用户注册：公开填写编码/名称/岗位/所属组/所属项目，先写入人员档案（申请中）。
// 项目经理或管理员审核通过后，才生成/同步用户账号并置为已生效。
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'
import { isSystemAdminRole } from '../middleware/scope.js'
import { createPersonnel, activatePersonnel, PERSONNEL_COLS } from './archives.js'

export async function registrationOptions() {
  const [roles, projects] = await Promise.all([
    pool.query('SELECT code, name FROM roles ORDER BY code'),
    pool.query("SELECT code, name FROM projects WHERE status = '已生效' AND enabled = true ORDER BY code"),
  ])
  return {
    roles: roles.rows.filter((r) => !isSystemAdminRole(r.code, r.name)),
    projects: projects.rows,
  }
}

export async function registerUser(b) {
  const { rows: roleRows } = await pool.query(
    'SELECT code, name FROM roles WHERE code = $1 OR name = $1 ORDER BY (code = $1) DESC, code LIMIT 1',
    [b.role],
  )
  const role = roleRows[0]
  if (!role) throw new HttpError(400, ERR.VALIDATION, '岗位不存在', [{ field: 'role' }])
  if (isSystemAdminRole(role.code, role.name)) {
    throw new HttpError(403, ERR.FORBIDDEN, '管理员角色不允许注册', [{ field: 'role' }])
  }

  const projects = [...new Set(b.projects.map((p) => String(p).trim()).filter(Boolean))]
  const username = b.code.toLowerCase()
  // 提前拦截与存量登录账号同名的编码，避免审核时覆盖已有账号资料。
  const exists = await pool.query('SELECT 1 FROM users WHERE username = $1', [username])
  if (exists.rowCount) throw new HttpError(409, ERR.CONFLICT, '登录账号已存在，请更换编码', [{ field: 'code' }])

  const person = await createPersonnel({
    code: b.code,
    name: b.name,
    role: role.code,
    group: b.group || null,
    projects,
    enabled: false,
    preset: false,
    status: '申请中',
    applied_at: new Date(),
  }, null, { skipUserSync: true })

  return {
    code: person.code,
    username,
    name: person.name,
    role: role.name,
    group: person.group,
    projects: person.projects,
    status: person.status,
    applied_at: person.applied_at,
  }
}

// 仅项目经理/管理员可调用（路由层校验）：通过→生成用户并生效，拒绝→保持禁用。
export async function reviewRegistration(code, b, actor) {
  const found = (await pool.query('SELECT status FROM personnel WHERE code=$1', [code])).rows[0]
  if (!found) throw new HttpError(404, ERR.NOT_FOUND, '注册申请不存在')
  if (found.status !== '申请中') {
    throw new HttpError(409, ERR.CONFLICT, '该注册申请已处理，不能重复审核', [{ field: 'code' }])
  }
  const approve = b.approve === true || b.approve === 'true'
  if (approve) {
    // 审核间隔可能有同名账号产生，此时不能覆盖已有账号。
    const linked = await pool.query('SELECT id FROM users WHERE personnel_code=$1', [code])
    if (!linked.rowCount) {
      const taken = await pool.query('SELECT 1 FROM users WHERE username=$1', [code.toLowerCase()])
      if (taken.rowCount) {
        throw new HttpError(409, ERR.CONFLICT, '登录账号已存在，无法审核通过', [{ field: 'code' }])
      }
    }
    await activatePersonnel(code)
  }
  const { rows } = await pool.query(
    `UPDATE personnel SET status=$2, enabled=$3, reviewed_by=$4, reviewed_at=now(), review_note=$5
     WHERE code=$1 RETURNING ${PERSONNEL_COLS}`,
    [code, approve ? '已生效' : '已拒绝', approve, actor?.username || actor?.person || '', b.note || null],
  )
  return rows[0]
}
