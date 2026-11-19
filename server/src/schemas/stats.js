// 统计/首页校验
import { query, body, param } from 'express-validator'

export const pivotRules = [
  query('dim').optional().isIn(['owner', 'project', 'status', 'module', 'priority', 'type']).withMessage('维度非法'),
  query('personField').optional().isIn(['owner', 'developer']),
  query('timeField').optional().isIn(['planEnd', 'resolvedAt']),
  query('granularity').optional().isIn(['day', 'week', 'month']),
  query('status').optional().isString(),
  query('rowFilter').optional().isString(),
  query('pageSize').optional().isInt({ min: 1, max: 200 }).toInt(),
]

export const noticeBody = [
  body('title').isString().trim().notEmpty().withMessage('标题必填'),
  body('type').optional({ nullable: true }).isString(),
  body('content').optional({ nullable: true }).isString(),
  body('date').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
  body('pinned').optional().isBoolean().toBoolean(),
]

export const todoBody = [
  body('text').isString().trim().notEmpty().withMessage('待办内容必填'),
  body('owner').optional({ nullable: true }).isString(),
  body('due').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
  body('prio').optional().isIn(['C', 'H', 'M', 'L']),
  body('done').optional().isBoolean().toBoolean(),
]

export const idParam = param('id').isString().trim().notEmpty()
