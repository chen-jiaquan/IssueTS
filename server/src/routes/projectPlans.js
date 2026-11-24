// 项目计划：编写 / Excel 导入 / 父子级汇总
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { attachScope } from '../middleware/scope.js'
import { ok } from '../utils/resp.js'
import { uploadSingle, readHeaders } from '../services/excel.js'
import { planBody, planIdParam, batchPlanBody, calendarYearParam, calendarBody } from '../schemas/projectPlans.js'
import * as P from '../services/projectPlans.js'
import * as C from '../services/workCalendar.js'

const router = Router()
router.use(authRequired, loadProfile, attachScope)

router.get('/', hasPerm('ISSUE_VIEW'),
  asyncHandler(async (req, res) => {
    const project = typeof req.query.project === 'string' ? req.query.project : null
    ok(res, await P.listPlans(req.scope, project))
  }))

// 导入：先读表头供前端字段对照，再按 mapping 导入（失败行生成清单文件）
router.get('/import/fields', hasPerm('ISSUE_IMPORT'),
  asyncHandler(async (_req, res) => ok(res, P.planImportFields())))
router.post('/import/headers', hasPerm('ISSUE_IMPORT'), uploadSingle,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new Error('请选择 Excel 文件')
    ok(res, { headers: await readHeaders(req.file.buffer) })
  }))
router.post('/import', hasPerm('ISSUE_IMPORT'), uploadSingle,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new Error('请选择 Excel 文件')
    let mapping = req.body?.mapping
    if (typeof mapping === 'string') {
      try { mapping = JSON.parse(mapping) } catch { mapping = null }
    }
    try {
      const result = await P.importPlans(req.file.buffer, req.profile, req.scope, mapping)
      console.log(`[plan-import] ${req.profile.username} 成功=${result.imported} 失败=${result.failed} 清单=${result.failUrl || '-'}`)
      ok(res, result)
    } catch (e) {
      console.error(`[plan-import] ${req.profile.username} 失败: ${e.message}`, e.stack)
      throw e
    }
  }))

// 导出：按当前项目筛选 + 数据范围导出全部计划（不分页）
router.get('/export', hasPerm('DATA_EXPORT'),
  asyncHandler(async (req, res) => {
    const project = typeof req.query.project === 'string' && req.query.project ? req.query.project : null
    const buf = await P.exportPlans(req.scope, project)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="project-plans-${Date.now()}.xlsx"`)
    res.send(buf)
  }))

router.get('/calendars', hasPerm('ISSUE_VIEW'),
  asyncHandler(async (_req, res) => ok(res, await C.listCalendars())))

router.get('/calendars/gov/:year', hasPerm('ISSUE_CREATE'), calendarYearParam, validate,
  asyncHandler(async (req, res) => ok(res, await C.fetchGovCalendar(req.params.year))))

router.put('/calendars/:year', hasPerm('ISSUE_CREATE'), calendarYearParam, calendarBody, validate,
  asyncHandler(async (req, res) => ok(res, await C.saveCalendar(req.params.year, req.body))))

router.post('/batch', hasPerm('ISSUE_CREATE'), batchPlanBody, validate,
  asyncHandler(async (req, res) => ok(res, await P.batchSavePlans(req.body.rows, req.profile, req.scope))))

router.post('/', hasPerm('ISSUE_CREATE'), planBody, validate,
  asyncHandler(async (req, res) => ok(res, await P.createPlan(req.body, req.profile, req.scope))))

router.get('/:id/logs', hasPerm('ISSUE_VIEW'), planIdParam, validate,
  asyncHandler(async (req, res) => ok(res, await P.logsOfPlan(req.params.id, req.scope))))

router.put('/:id', hasPerm('ISSUE_CREATE'), planIdParam, planBody, validate,
  asyncHandler(async (req, res) => ok(res, await P.updatePlan(req.params.id, req.body, req.scope, req.profile))))

router.delete('/:id', hasPerm('ISSUE_CREATE'), planIdParam, validate,
  asyncHandler(async (req, res) => ok(res, await P.deletePlan(req.params.id, req.scope))))

export default router
