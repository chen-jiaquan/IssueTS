// 项目申请：登录页公开提交，管理员审核后生效（见 docs/API契约.md）
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { systemAdminOnly } from '../middleware/rbac.js'
import { ok } from '../utils/resp.js'
import { submitProjectApplication, reviewProjectApplication } from '../services/archives.js'
import { projectApplicationRules, projectApplicationReviewRules } from '../schemas/archives.js'

const router = Router()

// POST /api/project-applications —— 无鉴权，提交后进入“申请中”
router.post('/', projectApplicationRules, validate, asyncHandler(async (req, res) => {
  ok(res, await submitProjectApplication(req.body), '申请已提交，待管理员审核')
}))

// PUT /api/project-applications/:code/review —— 仅系统管理员可审核
router.put('/:code/review', authRequired, loadProfile, systemAdminOnly,
  projectApplicationReviewRules, validate, asyncHandler(async (req, res) => {
    const row = await reviewProjectApplication(req.params.code, req.body, req.profile)
    ok(res, row, req.body.approve ? '审核通过，项目已生效' : '已拒绝该申请')
  }))

export default router
