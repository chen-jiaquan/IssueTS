import { body } from 'express-validator'

const settingProjectsRules = [
  body('projects').optional().isArray().withMessage('所属项目须为数组'),
  body('projects.*').optional().isString().trim().notEmpty().withMessage('所属项目编码非法'),
  body('id').optional().isInt({ min: 1 }),
]

// 系统设置：问题导出上限。0=不限制，正整数=最多导出行数。
export const issueExportLimitRules = [
  body('value')
    .isInt({ min: 0, max: 100000 })
    .withMessage('导出上限须为 0~100000 的整数（0=不限制）')
    .toInt(),
  ...settingProjectsRules,
]

// 系统设置：人员下推用户的初始密码
export const defaultUserPasswordRules = [
  body('value')
    .isString().trim().isLength({ min: 6, max: 64 })
    .withMessage('默认密码须为 6~64 位字符串'),
  ...settingProjectsRules,
]
