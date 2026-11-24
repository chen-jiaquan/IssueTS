// 校验规则：与 docs/API契约.md 第 8 节对齐
import { body } from 'express-validator'

export const loginRules = [
  body('username').isString().trim().notEmpty().withMessage('用户名必填'),
  body('password').isString().notEmpty().withMessage('密码必填'),
  // 管理员可不选；非管理员由服务层校验项目权限
  body('project').optional({ nullable: true }).isString().trim().withMessage('项目编码格式非法'),
  body('forceLogout').optional().isBoolean().withMessage('forceLogout 须为布尔值'),
]

export const refreshRules = [
  body('refreshToken').isString().notEmpty().withMessage('refreshToken 必填'),
]
