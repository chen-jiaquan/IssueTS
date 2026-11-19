import { body } from 'express-validator'

// 系统设置：问题导出上限。0=不限制，正整数=最多导出行数。
export const issueExportLimitRules = [
  body('value')
    .isInt({ min: 0, max: 100000 })
    .withMessage('导出上限须为 0~100000 的整数（0=不限制）')
    .toInt(),
]
