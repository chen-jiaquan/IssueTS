// 通知端点（见 docs/API契约.md 第 4 节 /api/notices）
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { attachScope, assertProjectVisible } from '../middleware/scope.js'
import { hasPerm } from '../middleware/rbac.js'
import { noticeBody, idParam } from '../schemas/stats.js'
import * as H from '../services/home.js'
import { ok } from '../utils/resp.js'

const router = Router()
router.use(authRequired, loadProfile, attachScope)

router.get('/', hasPerm('DASH_VIEW'), asyncHandler(async (req, res) => ok(res, await H.listNotices(req.profile, req.scope))))

router.post('/', hasPerm('DASH_NOTICE'), noticeBody, validate,
  asyncHandler(async (req, res) => {
    for (const project of req.body.projects) assertProjectVisible(req, project)
    ok(res, await H.createNotice(req.body, req.profile))
  }))

router.put('/:id', hasPerm('DASH_NOTICE'), idParam, noticeBody, validate,
  asyncHandler(async (req, res) => {
    for (const project of req.body.projects) assertProjectVisible(req, project)
    ok(res, await H.updateNotice(req.params.id, req.body))
  }))

router.delete('/:id', hasPerm('DASH_NOTICE'), idParam, validate,
  asyncHandler(async (req, res) => {
    for (const project of await H.getNoticeProjects(req.params.id)) assertProjectVisible(req, project)
    await H.deleteNotice(req.params.id); ok(res)
  }))

export default router
