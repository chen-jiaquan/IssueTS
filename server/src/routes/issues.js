// 问题跟踪端点（见 docs/API契约.md 第 2 节）
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { attachScope, assertProjectVisible } from '../middleware/scope.js'
import { ok } from '../utils/resp.js'
import * as S from '../services/issues.js'
import * as X from '../services/excel.js'
import {
  issueCreateRules, issueUpdateRules, seqParam, batchRules, batchDeleteRules, assignRules, listQueryRules,
  exportQueryRules,
} from '../schemas/issues.js'

const router = Router()
router.use(authRequired, loadProfile)

// 列表：ISSUE_VIEW + scope 数据范围
router.get('/', hasPerm('ISSUE_VIEW'), listQueryRules, validate, attachScope,
  asyncHandler(async (req, res) => ok(res, await S.listIssues(req.query, req.scope))))

// Excel 导入（multipart，字段 file）
// 导入：先读表头供前端做字段对照，再按 mapping 导入（失败行生成清单文件）
router.get('/import/fields', hasPerm('ISSUE_IMPORT'),
  asyncHandler(async (_req, res) => ok(res, X.importFields())))
router.post('/import/headers', hasPerm('ISSUE_IMPORT'), X.uploadSingle,
  asyncHandler(async (req, res) => ok(res, { headers: await X.readHeaders(req.file.buffer) })))
router.post('/import', hasPerm('ISSUE_IMPORT'), X.uploadSingle, attachScope,
  asyncHandler(async (req, res) => {
    try {
      let mapping = req.body?.mapping
      if (typeof mapping === 'string') {
        try { mapping = JSON.parse(mapping) } catch { mapping = null }
      }
      const result = await X.importExcel(req.file.buffer, req, mapping)
      console.log(`[import] ${req.profile.username} 成功=${result.imported} 失败=${result.failed} 清单=${result.failUrl || '-'}`)
      ok(res, result)
    } catch (e) {
      console.error(`[import] ${req.profile.username} 失败: ${e.message}`, e.stack)
      throw e
    }
  }))

// Excel 导出（scope 过滤 + 排除虚拟列；不分页、不受 pageSize 限制）
router.get('/export', hasPerm('DATA_EXPORT'), exportQueryRules, validate, attachScope,
  asyncHandler(async (req, res) => {
    const buf = await X.exportExcel(req.query, req.scope)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="issues-${Date.now()}.xlsx"`)
    res.send(buf)
  }))

// 表头筛选候选值（全表去重，跨页可选；须在 /:seq 之前注册）
router.get('/filter-options', hasPerm('ISSUE_VIEW'), attachScope,
  asyncHandler(async (req, res) => ok(res, await S.filterOptions(req.scope))))

// 详情（含 track、logs 聚合）
router.get('/:seq', hasPerm('ISSUE_VIEW'), seqParam, validate, attachScope,
  asyncHandler(async (req, res) => ok(res, await S.getIssueBySeq(req.params.seq, req.scope))))

// 新增（留痕 __create__）
router.post('/', hasPerm('ISSUE_CREATE'), issueCreateRules, validate, attachScope,
  asyncHandler(async (req, res) => {
    assertProjectVisible(req, req.body.project)
    ok(res, await S.createIssue(req.body, req.profile))
  }))

// 编辑全部字段（字段级留痕）
router.put('/:seq', hasPerm('ISSUE_EDIT'), seqParam, issueUpdateRules, validate, attachScope,
  asyncHandler(async (req, res) => {
    const old = await S.getIssueBySeq(req.params.seq, req.scope)
    if (req.body.project && req.body.project !== old.project) assertProjectVisible(req, req.body.project)
    const { issue, changed } = await S.updateIssue(req.params.seq, req.body, req.profile, req.scope)
    ok(res, { issue, changed: changed.map((k) => S.FIELD_LABELS[k] ?? k) })
  }))

// 批量删除（须在 /:seq 之前注册，避免被当成 seq 参数）
router.post('/batch-delete', hasPerm('ISSUE_DELETE'), batchDeleteRules, validate, attachScope,
  asyncHandler(async (req, res) => ok(res, await S.batchDelete(req.body.seqs, req.scope))))

// 删除
router.delete('/:seq', hasPerm('ISSUE_DELETE'), seqParam, validate, attachScope,
  asyncHandler(async (req, res) => { await S.deleteIssue(req.params.seq, req.scope); ok(res) }))

// 批量行内修改（逐行留痕）
router.post('/batch', hasPerm('ISSUE_BATCH'), batchRules, validate, attachScope,
  asyncHandler(async (req, res) => ok(res, await S.batchUpdate(req.body.seqs, req.body.patch, req.profile, req.scope))))

// 行内分配负责人/开发人员 + 生成通知
router.post('/:seq/assign', hasPerm('ISSUE_ASSIGN'), seqParam, assignRules, validate, attachScope,
  asyncHandler(async (req, res) => ok(res, await S.assign(req.params.seq, req.body.field, req.body.value, req.profile, req.scope))))

// 单问题修改日志
router.get('/:seq/logs', hasPerm('ISSUE_LOG'), seqParam, validate, attachScope,
  asyncHandler(async (req, res) => { await S.getIssueBySeq(req.params.seq, req.scope); ok(res, await S.logsOfIssue(req.params.seq)) }))

export default router
