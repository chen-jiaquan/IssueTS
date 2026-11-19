// 首页看板端点（见 docs/API契约.md 第 4 节）：summary / alerts
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { attachScope } from '../middleware/scope.js'
import { summary, alerts } from '../services/home.js'
import { ok } from '../utils/resp.js'

const router = Router()
router.use(authRequired, loadProfile, attachScope)

router.get('/summary', hasPerm('DASH_VIEW'),
  asyncHandler(async (req, res) => ok(res, await summary(req.scope))))

router.get('/alerts', hasPerm('DASH_VIEW'),
  asyncHandler(async (req, res) => ok(res, await alerts(req.scope))))

export default router
