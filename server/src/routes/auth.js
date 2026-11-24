// 登录/刷新/登出/当前用户（见 docs/API契约.md 第 1 节）
import { Router } from 'express'
import { pool } from '../db/pool.js'
import { ok, fail, ERR } from '../utils/resp.js'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { loginRules, refreshRules } from '../schemas/auth.js'
import { authRequired, loadProfile, signAccess, signRefresh, verifyToken } from '../middleware/auth.js'
import { verifyLogin, findUserById, profileOf, assertLoginProject, listLoginProjects } from '../services/auth.js'
import {
  createTokenIds, createSession, refreshSession, endSession, endSessionByRefreshJti,
  getIdleTimeoutMinutes, expireIdleSessions, listActiveSessions, endAllUserSessions,
} from '../services/sessions.js'

const router = Router()

// POST /api/auth/login-projects —— 校验账号密码后，只返回该账号可见的已生效项目
router.post('/login-projects', loginRules, validate, asyncHandler(async (req, res) => {
  const user = await verifyLogin(req.body.username, req.body.password)
  ok(res, await listLoginProjects(user))
}))

// POST /api/auth/login —— 无鉴权
router.post('/login', loginRules, validate, asyncHandler(async (req, res) => {
  const { username, password, project, forceLogout } = req.body
  const user = await verifyLogin(username, password)
  await assertLoginProject(user, project)
  const idleMinutes = await getIdleTimeoutMinutes()
  await expireIdleSessions(user.id, idleMinutes)
  const activeSessions = await listActiveSessions(user.id)
  if (activeSessions.length && !forceLogout) {
    return fail(res, 409, ERR.CONFLICT, '该账号已在其他位置登录', {
      code: 'SESSION_CONFLICT',
      sessions: activeSessions.map((s) => ({
        id: s.id,
        project: s.login_project || 'ALL',
        login_at: s.login_at,
        last_seen_at: s.last_seen_at,
      })),
    })
  }
  if (activeSessions.length) await endAllUserSessions(user.id, 'kicked')
  const profile = await profileOf(user)
  const { accessJti, refreshJti } = createTokenIds()
  const session = await createSession({
    userId: user.id,
    username: user.username,
    loginProject: project || null,
    accessJti,
    refreshJti,
  })
  ok(res, {
    accessToken: signAccess({ sub: String(user.id), username: user.username, sid: String(session.id) }, accessJti),
    refreshToken: signRefresh({ sub: String(user.id), username: user.username }, refreshJti),
    user: profile,
  })
}))

// POST /api/auth/refresh —— 用 Refresh Token 换新 Access Token
router.post('/refresh', refreshRules, validate, asyncHandler(async (req, res) => {
  const { refreshToken } = req.body
  let payload
  try {
    payload = verifyToken(refreshToken)
    if (payload.typ !== 'refresh') throw new Error('bad typ')
  } catch {
    return fail(res, 401, ERR.UNAUTHORIZED, 'Refresh Token 无效或已过期')
  }
  // 已登出撤销？
  const { rows } = await pool.query('SELECT 1 FROM refresh_revocations WHERE jti = $1', [payload.jti])
  if (rows.length) return fail(res, 401, ERR.UNAUTHORIZED, 'Refresh Token 已失效，请重新登录')
  const user = await findUserById(Number(payload.sub))
  if (!user || user.status !== '启用') return fail(res, 401, ERR.UNAUTHORIZED, '账号不可用')
  const { accessJti } = createTokenIds()
  const session = await refreshSession(payload.jti, accessJti)
  if (!session) return fail(res, 401, ERR.UNAUTHORIZED, '会话已失效，请重新登录')
  ok(res, {
    accessToken: signAccess({ sub: String(user.id), username: user.username, sid: String(session.id) }, accessJti),
    user: await profileOf(user),
  })
}))

// POST /api/auth/logout —— 登录态；撤销传入的 Refresh Token（可选）
router.post('/logout', authRequired, asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken
  if (refreshToken) {
    try {
      const payload = verifyToken(refreshToken)
      if (payload.typ === 'refresh') {
        await pool.query(
          `INSERT INTO refresh_revocations(jti, expires_at) VALUES ($1,$2) ON CONFLICT (jti) DO NOTHING`,
          [payload.jti, new Date(payload.exp * 1000)],
        )
      }
    } catch {
      // 无效 refreshToken 忽略（已过期即自然失效）
    }
  }
  await endSession(req.auth?.sid, 'logout')
  ok(res, null, '已登出')
}))

// GET /api/auth/me —— 当前用户/角色/权限位/可见项目
router.get('/me', authRequired, loadProfile, (req, res) => {
  ok(res, req.profile)
})

export default router
