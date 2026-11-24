import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { systemAdminOnly } from '../middleware/rbac.js'
import { ok, fail, ERR } from '../utils/resp.js'
import { getMonitorStatus } from '../services/monitor.js'
import {
  kickSession, getIdleTimeoutMinutes, setIdleTimeoutMinutes,
} from '../services/sessions.js'
import { getPortConfig, updatePortConfig } from '../services/envConfig.js'

const router = Router()
router.use(authRequired, loadProfile, systemAdminOnly)

router.get('/status', asyncHandler(async (_req, res) => ok(res, await getMonitorStatus())))
router.get('/ports', asyncHandler(async (_req, res) => ok(res, await getPortConfig())))
router.put('/ports', asyncHandler(async (req, res) => ok(res, await updatePortConfig(req.body))))
router.get('/idle-timeout', asyncHandler(async (_req, res) => ok(res, { minutes: await getIdleTimeoutMinutes() })))
router.put('/idle-timeout', asyncHandler(async (req, res) =>
  ok(res, { minutes: await setIdleTimeoutMinutes(req.body.minutes) })))
router.post('/sessions/:id/kick', asyncHandler(async (req, res) => {
  const kicked = await kickSession(req.params.id)
  if (!kicked) return fail(res, 404, ERR.NOT_FOUND, '在线会话不存在或已结束')
  ok(res, { id: Number(req.params.id) }, '已强制下线')
}))

export default router
