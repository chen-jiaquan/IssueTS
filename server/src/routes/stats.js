// 统计透视端点（见 docs/API契约.md 第 3 节）
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { attachScope } from '../middleware/scope.js'
import { pivotRules, exportPivotBody, loadMatrixRules } from '../schemas/stats.js'
import { pivot, exportPivot, loadMatrix } from '../services/stats.js'
import { ok } from '../utils/resp.js'

const router = Router()
router.use(authRequired, loadProfile)

router.get('/pivot', hasPerm('ISSUE_VIEW'), pivotRules, validate, attachScope,
  asyncHandler(async (req, res) => ok(res, await pivot(req.query, req.scope))))

router.get('/load-matrix', hasPerm('ISSUE_VIEW'), loadMatrixRules, validate, attachScope,
  asyncHandler(async (req, res) => ok(res, await loadMatrix(req.query, req.scope))))

router.post('/export', hasPerm('DATA_EXPORT'), exportPivotBody, validate, attachScope,
  asyncHandler(async (req, res) => {
    const buf = await exportPivot(req.body.filters || {}, req.scope, req.body.charts || [])
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="stats-${Date.now()}.xlsx"`)
    res.send(buf)
  }))

export default router
