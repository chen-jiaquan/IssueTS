// 档案模块校验规则（与 docs/API契约.md 第 8 节对齐）
import { body, param } from 'express-validator'

// 字典 key 白名单（数据模型 dict_items）
export const DICT_KEYS = ['project', 'stage', 'type', 'module', 'priority', 'impact', 'status', 'pending_test', 'customer_test']

const usernameRules = (optional) => {
  const r = body('username').isString().trim().notEmpty().withMessage('用户名必填').isLength({ max: 64 })
  return optional ? r.optional() : r
}
const projectsRule = body('projects').isArray().withMessage('projects 必须为数组')
  .custom((v) => v.length === 0 || v.includes('ALL') || v.every((x) => typeof x === 'string'))
  .withMessage('projects 格式非法')

export const userRules = (partial = false) => [
  usernameRules(partial),
  body('password').isString().isLength({ min: 6 }).withMessage('密码至少 6 位').if((v, { req }) => !partial || v !== undefined),
  body('person').optional({ nullable: true }).isString(),
  body('role_code').isString().notEmpty().withMessage('角色必填'),
  body('status').optional().isIn(['启用', '停用']),
  partial ? projectsRule.optional() : projectsRule,
]

export const roleRules = (partial = false) => [
  body('code').isString().trim().isLength({ max: 16 }).withMessage('角色编码必填').if(() => !partial),
  body('name').isString().trim().notEmpty().withMessage('角色名必填').if(() => !partial),
  body('name').optional().isString(),
  body('desc').optional({ nullable: true }).isString(),
  body('external').optional().isBoolean(),
  body('color').optional({ nullable: true }).isString(),
]

export const permRules = (partial = false) => [
  body('code').isString().trim().isLength({ max: 32 }).withMessage('权限编码必填').if(() => !partial),
  body('name').isString().trim().notEmpty().withMessage('权限名必填').if(() => !partial),
  body('module').optional({ nullable: true }).isString(),
  body('name').optional().isString(),
  body('desc').optional({ nullable: true }).isString(),
  body('allow').optional({ nullable: true }).isArray(),
]

const codeName = (codeMax = 32) => [
  body('code').isString().trim().isLength({ max: codeMax }).withMessage('编码必填'),
  body('name').optional({ nullable: true }).isString(),
  body('note').optional({ nullable: true }).isString(),
  body('color').optional({ nullable: true }).isString(),
]

export const projectRules = codeName(32)
export const productRules = codeName(32)

export const personnelRules = (partial = false) => [
  body('code').isString().trim().isLength({ max: 16 }).withMessage('人员编码必填').if(() => !partial),
  body('name').isString().trim().notEmpty().withMessage('姓名必填').if(() => !partial),
  body('name').optional().isString(),
  body('role').optional({ nullable: true }).isString(),
  body('group').optional({ nullable: true }).isString(),
  body('color').optional({ nullable: true }).isString(),
]

export const dictItemRules = (partial = false) => [
  body('dict_key').isIn(DICT_KEYS).withMessage('dict_key 非法').if(() => !partial),
  body('dict_key').optional().isIn(DICT_KEYS).withMessage('dict_key 非法'),
  body('value').isString().trim().notEmpty().withMessage('value 必填').if(() => !partial),
  body('value').optional().isString().notEmpty().withMessage('value 必填'),
  body('label').optional({ nullable: true }).isString(),
  body('color').optional({ nullable: true }).isString(),
  body('note').optional({ nullable: true }).isString(),
  body('product_code').optional({ nullable: true }).isString(),
  body('sort').optional().isInt(),
]

export const customFieldRules = (partial = false) => [
  body('label').isString().trim().notEmpty().withMessage('列名必填').if(() => !partial),
  body('label').optional().isString().notEmpty(),
  body('type').isIn(['text', 'textarea', 'number', 'date']).withMessage('类型非法').if(() => !partial),
  body('type').optional().isIn(['text', 'textarea', 'number', 'date']),
]

export const noticeTypeRules = (partial = false) => [
  body('name').isString().trim().notEmpty().withMessage('类型名必填').if(() => !partial),
  body('name').optional().isString().notEmpty(),
]

export const todoPrioRules = (partial = false) => [
  body('code').isString().trim().isIn(['C', 'H', 'M', 'L']).withMessage('优先级编码非法').if(() => !partial),
  body('label').optional({ nullable: true }).isString(),
]

export const alertRulePutRules = [
  body('key').isString().notEmpty(),
  body('enabled').isBoolean().withMessage('enabled 必须为布尔'),
  body('days').optional({ nullable: true }).isInt(),
]

export const rolePermPutRules = [
  body('role_code').isString().notEmpty(),
  body('perm_codes').isArray().withMessage('perm_codes 必须为数组'),
]

export const requiredFieldsPutRules = [
  body('fields').isArray().withMessage('fields 必须为数组'),
]

export const idParam = (name = 'id') => param(name).isString().trim().notEmpty()
