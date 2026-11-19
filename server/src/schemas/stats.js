// 统计/首页校验
import { query, body, param } from 'express-validator'

export const pivotRules = [
  query('dim').optional().isIn(['owner', 'project', 'status', 'module', 'priority', 'type']).withMessage('维度非法'),
  query('personField').optional().isIn(['owner', 'developer']),
  query('timeField').optional().isIn(['planEnd', 'resolvedAt']),
  query('granularity').optional().isIn(['day', 'week', 'month']),
  query('project').optional().isString(),
  query('stage').optional().isString(),
  query('status').optional().isString(),
  query('dateFrom').optional({ checkFalsy: true }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('开始日期格式非法'),
  query('dateTo').optional({ checkFalsy: true }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('结束日期格式非法'),
  query('rowFilter').optional().isString(),
  query('pageSize').optional().isInt({ min: 1, max: 200 }).toInt(),
]

export const exportPivotBody = [
  body('filters').optional().isObject().withMessage('filters 非法'),
  body('charts').optional().isArray({ max: 5 }).withMessage('charts 非法'),
  body('charts.*').optional().isString().isLength({ max: 2 * 1024 * 1024 }).withMessage('图表数据非法'),
]

// 首页统计过滤：仅项目
export const homeFilterRules = [
  query('project').optional().isString(),
]

export const noticeBody = [
  body('title').isString().trim().notEmpty().withMessage('标题必填'),
  body('projects').isArray({ min: 1 }).withMessage('项目必填'),
  body('projects.*').isString().trim().notEmpty(),
  body('type').optional({ nullable: true }).isString().trim().notEmpty(),
  body('content').optional({ nullable: true }).isString(),
  body('date').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
  body('pinned').optional().isBoolean().toBoolean(),
  body('recipients').optional().isArray(),
  body('recipients.*').optional().isString().trim().notEmpty(),
  body('groups').optional().isArray(),
  body('groups.*').optional().isString().trim().notEmpty(),
]

export const todoBody = [
  body('text').isString().trim().notEmpty().withMessage('待办内容必填'),
  body('projects').optional().isArray(),
  body('projects.*').optional().isString().trim().notEmpty(),
  body('owner').optional({ nullable: true }).isString(),
  body('due').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
  body('prio').optional().isIn(['C', 'H', 'M', 'L']),
  body('done').optional().isBoolean().toBoolean(),
]

export const idParam = param('id').isString().trim().notEmpty()
