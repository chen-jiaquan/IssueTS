// 登录页用户注册入参校验：编码/名称/岗位/所属项目必填，所属组可选
import { body } from 'express-validator'

export const registrationRules = [
  body('code').isString().trim().notEmpty().withMessage('编码必填')
    .matches(/^[A-Za-z0-9_.-]+$/).withMessage('编码仅允许字母、数字及 . _ -')
    .isLength({ max: 16 }).withMessage('编码最多 16 位'),
  body('name').isString().trim().notEmpty().withMessage('名称必填')
    .isLength({ max: 64 }).withMessage('名称最多 64 位'),
  body('role').isString().trim().notEmpty().withMessage('岗位必填'),
  body('group').optional({ nullable: true }).isString().isLength({ max: 64 }).withMessage('所属组最多 64 位'),
  body('projects').isArray({ min: 1 }).withMessage('所属项目必填'),
  body('projects.*').isString().trim().notEmpty().withMessage('所属项目编码非法'),
]

export const registrationReviewRules = [
  body('approve').isBoolean().withMessage('审核结果必须为布尔'),
  body('note').optional({ nullable: true }).isString().isLength({ max: 255 }).withMessage('审核意见最多 255 字符'),
]
