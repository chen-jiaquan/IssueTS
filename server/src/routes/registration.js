// 用户注册：登录页公开填写，岗位与项目选项通过 /options 提供；
// 提交后进入人员档案待审核，项目经理/管理员审核通过后才生成用户账号。
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { registrationReviewerOnly } from '../middleware/rbac.js'
import { ok } from '../utils/resp.js'
import { registrationOptions, registerUser, reviewRegistration } from '../services/registration.js'
import { registrationRules, registrationReviewRules } from '../schemas/registration.js'

const router = Router()

// GET /api/registration/options —— 可选岗位（不含管理员）与已生效项目
router.get('/options', asyncHandler(async (_req, res) => ok(res, await registrationOptions())))

// POST /api/registration —— 写入人员档案，状态为“申请中”
router.post('/', registrationRules, validate, asyncHandler(async (req, res) => {
  ok(res, await registerUser(req.body), '注册信息已提交，待审核')
}))

// PUT /api/registration/:code/review —— 仅项目经理或管理员可审核
router.put('/:code/review', authRequired, loadProfile, registrationReviewerOnly,
  registrationReviewRules, validate, asyncHandler(async (req, res) => {
    const row = await reviewRegistration(req.params.code, req.body, req.profile)
    ok(res, row, req.body.approve ? '审核通过，用户账号已生成' : '已拒绝该注册申请')
  }))

export default router
