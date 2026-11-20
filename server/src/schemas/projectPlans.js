import { body, param } from 'express-validator'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const planBody = [
  body('project').isString().trim().notEmpty().withMessage('项目必填'),
  body('title').isString().trim().notEmpty().withMessage('计划名称必填'),
  body('parent_id').optional({ nullable: true }).isString(),
  body('owner').optional({ nullable: true }).isString(),
  body('start_date').optional({ nullable: true }).matches(DATE),
  body('end_date').optional({ nullable: true }).matches(DATE),
  body('hours').optional().isFloat({ min: 0 }),
  body('sort').optional().isInt(),
  body('note').optional({ nullable: true }).isString(),
]
export const planIdParam = [param('id').isString().trim().notEmpty()]
