// 鉴权服务：用户查询 / 登录校验 / 用户档案（角色+权限位+可见项目）
import bcrypt from 'bcryptjs'
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'

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
