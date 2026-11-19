// 校验规则：与 docs/API契约.md 第 8 节对齐
import { body } from 'express-validator'

export const loginRules = [
  body('username').isString().trim().notEmpty().withMessage('用户名必填'),
  body('password').isString().notEmpty().withMessage('密码必填'),
]

export const refreshRules = [
  body('refreshToken').isString().notEmpty().withMessage('refreshToken 必填'),
]
