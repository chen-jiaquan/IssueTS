// 鉴权服务：用户查询 / 登录校验 / 用户档案（角色+权限位+可见项目）
import bcrypt from 'bcryptjs'
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'
import { isSystemAdminRole } from '../middleware/scope.js'

const BASE_SELECT = `
  SELECT u.id, u.username, u.person, u.status, u.projects, u.role_code, u.password_hash,
         r.name AS role_name
  FROM users u LEFT JOIN roles r ON r.code = u.role_code`

export async function findUserByUsername(username) {
  const { rows } = await pool.query(`${BASE_SELECT} WHERE u.username = $1`, [username])
  return rows[0] || null
}

export async function findUserById(id) {
  const { rows } = await pool.query(`${BASE_SELECT} WHERE u.id = $1`, [id])
  return rows[0] || null
}

// 角色的权限位集合
export async function permsOfRole(roleCode) {
  const { rows } = await pool.query(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.code = rp.perm_code
     WHERE rp.role_code = $1`, [roleCode])
  return rows.map((r) => r.code)
}

// 组装前端档案：{ username, person, role, perms, projects }
export async function profileOf(user) {
  const perms = await permsOfRole(user.role_code)
  return {
    id: user.id,
    username: user.username,
    person: user.person,
    role: user.role_name,
    role_code: user.role_code,
    perms,
    projects: user.projects, // ["ALL"] 或项目编码数组
  }
}

// 登录校验：失败统一 40101（不区分账号不存在/密码错误，防枚举）
export async function verifyLogin(username, password) {
  const user = await findUserByUsername(username)
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new HttpError(401, ERR.UNAUTHORIZED, '用户名或密码错误')
  }
  if (user.status !== '启用') {
    throw new HttpError(403, ERR.FORBIDDEN, '账号已停用，请联系管理员')
  }
  return user
}

// 登录可见项目口径：null=全部项目；否则为显式项目编码集合。
// 与数据范围口径一致：['ALL']、显式项目数组、空数组 + PROJECT_ALL 权限位；管理员始终全部。
async function loginProjectCodes(user) {
  if (isSystemAdminRole(user.role_code, user.role_name)) return null
  const own = Array.isArray(user.projects) ? user.projects : []
  if (own.includes('ALL')) return null
  if (own.length) return new Set(own)
  if ((await permsOfRole(user.role_code)).includes('PROJECT_ALL')) return null
  return new Set()
}

// 登录页项目下拉：仅返回该账号可见的已生效项目。
export async function listLoginProjects(user) {
  const { rows } = await pool.query(
    "SELECT code, name FROM projects WHERE status='已生效' AND enabled=true ORDER BY code")
  const codes = await loginProjectCodes(user)
  return codes === null ? rows : rows.filter((p) => codes.has(p.code))
}

// 登录项目校验：管理员可不选项目；其余用户必须选择有权限的已生效项目。
export async function assertLoginProject(user, project) {
  if (isSystemAdminRole(user.role_code, user.role_name)) return
  const code = String(project ?? '').trim()
  if (!code) throw new HttpError(400, ERR.VALIDATION, '请选择登录项目', [{ field: 'project' }])

  const { rows } = await pool.query(
    "SELECT code FROM projects WHERE code=$1 AND status='已生效' AND enabled=true", [code])
  if (!rows.length) {
    throw new HttpError(400, ERR.VALIDATION, '所选项目不存在或已停用', [{ field: 'project' }])
  }

  const codes = await loginProjectCodes(user)
  if (codes !== null && !codes.has(code)) {
    throw new HttpError(403, ERR.FORBIDDEN, `无权访问项目：${code}`, [{ field: 'project' }])
  }
}
