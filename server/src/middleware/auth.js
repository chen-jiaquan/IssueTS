// JWT 中间件：双令牌签发（Access 15m / Refresh 7d）、校验、当前档案加载
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config/index.js'
import { fail, ERR } from '../utils/resp.js'
import { findUserById, profileOf } from '../services/auth.js'

export function signAccess(payload) {
  return jwt.sign({ ...payload, typ: 'access' }, config.jwt.secret,
    { expiresIn: config.jwt.accessTtl, jwtid: crypto.randomUUID() })
}

export function signRefresh(payload) {
  return jwt.sign({ ...payload, typ: 'refresh' }, config.jwt.secret,
    { expiresIn: config.jwt.refreshTtl, jwtid: crypto.randomUUID() })
}

export function verifyToken(token) {
  const payload = jwt.verify(token, config.jwt.secret) // 失败抛 TokenExpired/JsonWebTokenError
  return payload
}

// 校验 Access Token，注入 req.auth = { uid, username, jti }
export function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return fail(res, 401, ERR.UNAUTHORIZED, '未登录')
  try {
    const payload = verifyToken(token)
    if (payload.typ !== 'access') return fail(res, 401, ERR.UNAUTHORIZED, '令牌类型错误')
    req.auth = { uid: Number(payload.sub), username: payload.username, jti: payload.jti }
    next()
  } catch {
    return fail(res, 401, ERR.UNAUTHORIZED, '登录已过期，请重新登录')
  }
}

// 加载当前用户档案（角色/权限位/可见项目），供 rbac/scope 使用
// 每请求查库保证停用/改权即时生效；高频接口可后续接 Redis 缓存
export async function loadProfile(req, res, next) {
  try {
    const user = await findUserById(req.auth.uid)
    if (!user) return fail(res, 401, ERR.UNAUTHORIZED, '账号不存在')
    if (user.status !== '启用') return fail(res, 403, ERR.FORBIDDEN, '账号已停用')
    req.profile = await profileOf(user)
    next()
  } catch (err) {
    next(err)
  }
}
