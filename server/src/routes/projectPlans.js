// 项目计划：编写 / Excel 导入 / 父子级汇总
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { attachScope } from '../middleware/scope.js'
import { ok } from '../utils/resp.js'
import { uploadSingle } from '../services/excel.js'
import { planBody, planIdParam } from '../schemas/projectPlans.js'
import * as P from '../services/projectPlans.js'

const router = Router()
router.use(authRequired, loadProfile, attachScope)

router.get('/', hasPerm('ISSUE_VIEW'),
  asyncHandler(async (req, res) => ok(res, await P.listPlans(req.scope))))

router.get('/template', hasPerm('ISSUE_IMPORT'),
  asyncHandler(async (_req, res) => {
    const buf = await P.templateBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="project-plan-template.xlsx"')
    res.send(buf)
  }))

router.post('/import', hasPerm('ISSUE_IMPORT'), uploadSingle,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new Error('请选择 Excel 文件')
    ok(res, await P.importPlans(req.file.buffer, req.profile, req.scope))
  }))

router.post('/', hasPerm('ISSUE_CREATE'), planBody, validate,
  asyncHandler(async (req, res) => ok(res, await P.createPlan(req.body, req.profile, req.scope))))

router.put('/:id', hasPerm('ISSUE_CREATE'), planIdParam, planBody, validate,
  asyncHandler(async (req, res) => ok(res, await P.updatePlan(req.params.id, req.body, req.scope))))

router.delete('/:id', hasPerm('ISSUE_CREATE'), planIdParam, validate,
  asyncHandler(async (req, res) => ok(res, await P.deletePlan(req.params.id, req.scope))))

export default router
