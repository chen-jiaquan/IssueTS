// 问题模块校验（与 docs/API契约.md 第 8 节对齐）
import { body, param, query } from 'express-validator'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// 可写字段白名单（FIELDS ∪ custom_fields/track/image_url）
export const ISSUE_FIELDS = [
  'project', 'stage', 'type', 'module', 'desc', 'priority', 'impact',
  'reporter', 'reported_at', 'owner', 'plan_start', 'plan_end',
  'developer', 'solution', 'track', 'pending_test', 'status',
  'resolved_at', 'customer_test', 'customer_test_done', 'image_url', 'custom_fields',
]

const dateField = (key) =>
  body(key).optional({ nullable: true }).isString().matches(DATE_RE).withMessage(`${key} 日期格式需为 YYYY-MM-DD`)

const dictField = (key) =>
  body(key).optional({ nullable: true }).isString().trim().isLength({ max: 64 })

export const issueCreateRules = [
  body('project').isString().trim().notEmpty().withMessage('项目必填'),
  body('desc').isString().trim().notEmpty().withMessage('需求描述必填'),
  body('priority').isIn(['C', 'H', 'M', 'L']).withMessage('优先级非法'),
  body('status').isString().trim().notEmpty().withMessage('状态必填'),
  dictField('stage'), dictField('type'), dictField('module'), dictField('impact'),
  dictField('reporter'), dictField('owner'), dictField('developer'),
  dictField('pending_test'), dictField('customer_test'),
  body('solution').optional({ nullable: true }).isString(),
  body('image_url').optional({ nullable: true }).isString(),
  body('track').optional({ nullable: true }).isArray(),
  body('custom_fields').optional({ nullable: true }).isObject(),
  dateField('reported_at'), dateField('plan_start'), dateField('plan_end'),
  dateField('resolved_at'), dateField('customer_test_done'),
]

// 编辑：全字段可选（部分更新），有值才校验
export const issueUpdateRules = [
  body('project').optional({ nullable: true }).isString().trim().notEmpty(),
  body('desc').optional({ nullable: true }).isString().trim().notEmpty(),
  body('priority').optional({ nullable: true }).isIn(['C', 'H', 'M', 'L']),
  body('status').optional({ nullable: true }).isString().trim().notEmpty(),
  ...['stage', 'type', 'module', 'impact', 'reporter', 'owner', 'developer', 'pending_test', 'customer_test'].map(dictField),
  body('solution').optional({ nullable: true }).isString(),
  body('image_url').optional({ nullable: true }).isString(),
  body('track').optional({ nullable: true }).isArray(),
  body('custom_fields').optional({ nullable: true }).isObject(),
  dateField('reported_at'), dateField('plan_start'), dateField('plan_end'),
  dateField('resolved_at'), dateField('customer_test_done'),
]

export const seqParam = param('seq').isInt({ min: 1 }).withMessage('序号非法').toInt()

export const batchRules = [
  body('seqs').isArray({ min: 1 }).withMessage('seqs 必须为非空数组'),
  body('seqs.*').isInt({ min: 1 }).toInt(),
  body('patch').isObject().withMessage('patch 必须为对象')
    .custom((p) => Object.keys(p).every((k) => ISSUE_FIELDS.includes(k)))
    .withMessage('patch 含非法字段'),
]

// 批量删除：仅 seqs，逐行做 scope 校验
export const batchDeleteRules = [
  body('seqs').isArray({ min: 1 }).withMessage('seqs 必须为非空数组'),
  body('seqs.*').isInt({ min: 1 }).toInt(),
]

export const assignRules = [
  body('field').isIn(['owner', 'developer']).withMessage('field 仅支持 owner/developer'),
  body('value').isString().trim().notEmpty().withMessage('分配对象必填'),
]

// 列表：排序白名单，分页限制
export const SORTABLE = ['seq', 'project', 'priority', 'impact', 'status', 'reported_at', 'plan_end', 'resolved_at', 'updated_at']
// 表头下拉筛选：每列一个参数，值为逗号分隔的多选（服务层 toIn 拆分）
export const FILTERABLE = [
  'seq', 'project', 'stage', 'type', 'module', 'desc', 'priority', 'impact',
  'reporter', 'reported_at', 'owner', 'plan_start', 'plan_end', 'developer',
  'pending_test', 'status', 'resolved_at', 'customer_test', 'customer_test_done',
]
export const listQueryRules = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 2000 }).toInt(),
  query('sort').optional().isIn(SORTABLE).withMessage('排序字段非法'),
  query('order').optional().isIn(['asc', 'desc']),
  query('timeField').optional().isIn(['planEnd', 'resolvedAt']),
  query('dateFrom').optional({ checkFalsy: true }).matches(DATE_RE),
  query('dateTo').optional({ checkFalsy: true }).matches(DATE_RE),
  ...FILTERABLE.map((k) => query(k).optional().isString().withMessage(`${k} 筛选值非法`)),
]

// 导出：沿用同一套筛选条件，但不做分页/行数校验；page/pageSize 即使传入也忽略
export const exportQueryRules = [
  query('sort').optional().isIn(SORTABLE).withMessage('排序字段非法'),
  query('order').optional().isIn(['asc', 'desc']),
  ...FILTERABLE.map((k) => query(k).optional().isString().withMessage(`${k} 筛选值非法`)),
]

export const logsQueryRules = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('issue_seq').optional().isInt({ min: 1 }).toInt(),
  query('from').optional().matches(DATE_RE),
  query('to').optional().matches(DATE_RE),
]
