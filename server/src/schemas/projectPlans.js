import { body, param } from 'express-validator'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const planBody = [
  body('project').isString().trim().notEmpty().withMessage('项目必填'),
  body('title').isString().trim().notEmpty().withMessage('计划名称必填'),
  body('parent_id').optional({ nullable: true }).isString(),
  body('seq_no').optional({ nullable: true }).isString().isLength({ max: 64 }),
  body('owner').optional({ nullable: true }).isString(),
  body('status').optional({ nullable: true }).isString().isLength({ max: 32 }),
  body('assistant1').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('assistant2').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('track').optional().isArray().withMessage('跟踪记录须为数组'),
  body('track.*.date').optional().isString(),
  body('track.*.text').optional().isString(),
  body('track.*.by').optional().isString(),
  body('start_date').optional({ nullable: true }).matches(DATE),
  body('end_date').optional({ nullable: true }).matches(DATE),
  body('actual_start_date').optional({ nullable: true }).matches(DATE),
  body('actual_end_date').optional({ nullable: true }).matches(DATE),
  body('completion_rate').optional().isFloat({ min: 0, max: 100 }),
  body('adjusted_hours').optional().isFloat({ min: -100000000, max: 100000000 }),
  body('day_rate').optional().isFloat({ min: 0, max: 100000000 }),
  body('amount').optional().isFloat({ min: 0, max: 100000000000 }),
  body('planned_amount').optional().isFloat({ min: 0, max: 100000000000 }),
  body('actual_amount').optional().isFloat({ min: 0, max: 100000000000 }),
  body('hours').optional().isFloat({ min: 0 }),
  body('man_days').optional().isFloat({ min: 0 }),
  body('sort').optional().isInt(),
  body('note').optional({ nullable: true }).isString(),
  body('category').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('predecessor').optional({ nullable: true }).isString(),
  body('custom_fields').optional({ nullable: true }).isObject().withMessage('自定义字段须为对象'),
]
export const planIdParam = [param('id').isString().trim().notEmpty()]

const batchItemRules = [
  body('rows.*.id').optional({ nullable: true }).isString(),
  body('rows.*.project').isString().trim().notEmpty().withMessage('项目必填'),
  body('rows.*.title').isString().trim().notEmpty().withMessage('任务名称必填'),
  body('rows.*.parent_id').optional({ nullable: true }).isString(),
  body('rows.*.seq_no').optional({ nullable: true }).isString().isLength({ max: 64 }),
  body('rows.*.owner').optional({ nullable: true }).isString(),
  body('rows.*.status').optional({ nullable: true }).isString().isLength({ max: 32 }),
  body('rows.*.assistant1').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('rows.*.assistant2').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('rows.*.track').optional().isArray().withMessage('跟踪记录须为数组'),
  body('rows.*.track.*.date').optional().isString(),
  body('rows.*.track.*.text').optional().isString(),
  body('rows.*.track.*.by').optional().isString(),
  body('rows.*.start_date').optional({ nullable: true }).matches(DATE),
  body('rows.*.end_date').optional({ nullable: true }).matches(DATE),
  body('rows.*.actual_start_date').optional({ nullable: true }).matches(DATE),
  body('rows.*.actual_end_date').optional({ nullable: true }).matches(DATE),
  body('rows.*.completion_rate').optional().isFloat({ min: 0, max: 100 }),
  body('rows.*.adjusted_hours').optional().isFloat({ min: -100000000, max: 100000000 }),
  body('rows.*.day_rate').optional().isFloat({ min: 0, max: 100000000 }),
  body('rows.*.amount').optional().isFloat({ min: 0, max: 100000000000 }),
  body('rows.*.planned_amount').optional().isFloat({ min: 0, max: 100000000000 }),
  body('rows.*.actual_amount').optional().isFloat({ min: 0, max: 100000000000 }),
  body('rows.*.hours').optional().isFloat({ min: 0 }),
  body('rows.*.man_days').optional().isFloat({ min: 0 }),
  body('rows.*.sort').optional().isInt(),
  body('rows.*.note').optional({ nullable: true }).isString(),
  body('rows.*.category').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('rows.*.predecessor').optional({ nullable: true }).isString(),
  body('rows.*.custom_fields').optional({ nullable: true }).isObject().withMessage('自定义字段须为对象'),
]
export const batchPlanBody = [
  body('rows').isArray({ min: 1 }).withMessage('rows 必须为非空数组'),
  ...batchItemRules,
]

export const calendarYearParam = [param('year').isInt({ min: 2000, max: 2100 })]
export const calendarBody = [
  body('holidays').optional().isArray().withMessage('节假日须为数组'),
  body('holidays.*').optional().matches(DATE).withMessage('节假日日期格式非法'),
  body('workdays').optional().isArray().withMessage('调休工作日须为数组'),
  body('workdays.*').optional().matches(DATE).withMessage('调休工作日日期格式非法'),
  body('hours_per_day').optional().isFloat({ min: 0, max: 24 }).withMessage('每日工时须在 0~24 之间'),
]
