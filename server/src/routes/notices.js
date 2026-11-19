// 通知端点（见 docs/API契约.md 第 4 节 /api/notices）
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { noticeBody, idParam } from '../schemas/stats.js'
import * as H from '../services/home.js'
import { ok } from '../utils/resp.js'

const router = Router()
router.use(authRequired, loadProfile)

router.get('/', hasPerm('DASH_VIEW'), asyncHandler(async (_req, res) => ok(res, await H.listNotices())))

router.post('/', hasPerm('DASH_NOTICE'), noticeBody, validate,
  asyncHandler(async (req, res) => ok(res, await H.createNotice(req.body, req.profile))))

router.put('/:id', hasPerm('DASH_NOTICE'), idParam, noticeBody, validate,
  asyncHandler(async (req, res) => ok(res, await H.updateNotice(req.params.id, req.body))))

router.delete('/:id', hasPerm('DASH_NOTICE'), idParam, validate,
  asyncHandler(async (req, res) => { await H.deleteNotice(req.params.id); ok(res) }))

export default router
