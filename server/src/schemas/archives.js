// 档案模块校验规则（与 docs/API契约.md 第 8 节对齐）
import { body, param } from 'express-validator'

// 字典 key 白名单（数据模型 dict_items）
export const DICT_KEYS = ['stage', 'type', 'module', 'priority', 'impact', 'status', 'pending_test', 'customer_test']

const presetRule = body('preset').optional().isBoolean().withMessage('系统预置必须为布尔')

const usernameRules = (optional) => {
  const r = body('username').isString().trim().notEmpty().withMessage('用户名必填').isLength({ max: 64 })
  return optional ? r.optional() : r
}
const projectsRule = () => body('projects').isArray().withMessage('projects 必须为数组')
  .custom((v) => v.length === 0 || v.includes('ALL') || v.every((x) => typeof x === 'string'))
  .withMessage('projects 格式非法')

export const userRules = (partial = false) => [
  usernameRules(partial),
  body('password').if((v, { req }) => !partial || v !== undefined).isString().isLength({ min: 6 }).withMessage('密码至少 6 位'),
  body('person').optional({ nullable: true }).isString(),
  body('role_code').isString().notEmpty().withMessage('角色必填'),
  body('status').optional().isIn(['启用', '停用']),
  // 系统管理员角色允许不填；其余角色由 service 按目标角色强制必填。
  projectsRule().optional(),
  body('projects.*').isString().trim().notEmpty().withMessage('所属项目编码非法'),
  presetRule,
]

export const roleRules = (partial = false) => [
  body('code').if(() => !partial).isString().trim().isLength({ max: 16 }).withMessage('角色编码必填'),
  body('name').if(() => !partial).isString().trim().notEmpty().withMessage('角色名必填'),
  body('name').optional().isString(),
  body('desc').optional({ nullable: true }).isString(),
  body('external').optional().isBoolean(),
  body('color').optional({ nullable: true }).isString(),
  projectsRule().optional(),
  body('projects.*').isString().trim().notEmpty().withMessage('所属项目编码非法'),
  presetRule,
]

export const permRules = (partial = false) => [
  body('code').if(() => !partial).isString().trim().isLength({ max: 32 }).withMessage('权限编码必填'),
  body('name').if(() => !partial).isString().trim().notEmpty().withMessage('权限名必填'),
  body('module').optional({ nullable: true }).isString(),
  body('name').optional().isString(),
  body('desc').optional({ nullable: true }).isString(),
  body('allow').optional({ nullable: true }).isArray(),
  presetRule,
]

const enabledRule = body('enabled').optional().isBoolean().withMessage('enabled 必须为布尔')

const codeName = (codeMax = 32) => [
  body('code').isString().trim().isLength({ max: codeMax }).withMessage('编码必填'),
  body('name').optional({ nullable: true }).isString(),
  body('note').optional({ nullable: true }).isString(),
  body('color').optional({ nullable: true }).isString(),
  enabledRule, presetRule,
]

export const projectRules = codeName(32)
export const productRules = [...codeName(32), projectsRule().optional()]

export const personnelRules = (partial = false) => [
  body('code').if(() => !partial).isString().trim().isLength({ max: 16 }).withMessage('人员编码必填'),
  body('name').if(() => !partial).isString().trim().notEmpty().withMessage('姓名必填'),
  body('name').optional().isString(),
  body('role').optional({ nullable: true }).isString(),
  body('group').optional({ nullable: true }).isString(),
  body('color').optional({ nullable: true }).isString(),
  body('projects').optional().isArray().withMessage('所属项目须为数组'),
  body('projects.*').isString().trim().notEmpty().withMessage('所属项目编码非法'),
  enabledRule, presetRule,
]

export const dictItemRules = (partial = false) => [
  body('dict_key').if(() => !partial).isIn(DICT_KEYS).withMessage('dict_key 非法'),
  body('dict_key').optional().isIn(DICT_KEYS).withMessage('dict_key 非法'),
  body('value').if(() => !partial).isString().trim().notEmpty().withMessage('value 必填'),
  body('value').optional().isString().notEmpty().withMessage('value 必填'),
  body('label').optional({ nullable: true }).isString(),
  body('color').optional({ nullable: true }).isString(),
  body('note').optional({ nullable: true }).isString(),
  body('product_code').optional({ nullable: true }).isString(),
  body('project_code').optional({ nullable: true }).isString(),
  body('sort').optional().isInt(),
  enabledRule, presetRule,
]

export const customFieldRules = (partial = false) => [
  body('label').if(() => !partial).isString().trim().notEmpty().withMessage('列名必填'),
  body('label').optional().isString().notEmpty(),
  body('type').if(() => !partial).isIn(['text', 'textarea', 'number', 'date']).withMessage('类型非法'),
  body('type').optional().isIn(['text', 'textarea', 'number', 'date']),
  projectsRule().optional(), enabledRule, presetRule,
]

export const noticeTypeRules = (partial = false) => [
  body('name').if(() => !partial).isString().trim().notEmpty().withMessage('类型名必填'),
  body('name').optional().isString().notEmpty(),
  projectsRule().optional(), enabledRule, presetRule,
]

export const todoPrioRules = (partial = false) => [
  body('code').if(() => !partial).isString().trim().isIn(['C', 'H', 'M', 'L']).withMessage('优先级编码非法'),
  body('label').optional({ nullable: true }).isString(),
  projectsRule().optional(), enabledRule, presetRule,
]

export const alertRulePutRules = [
  body('key').isString().notEmpty(),
  body('enabled').isBoolean().withMessage('enabled 必须为布尔'),
  body('days').optional({ nullable: true }).isInt(),
  projectsRule().optional(),
  body('projects.*').isString().trim().notEmpty().withMessage('所属项目编码非法'),
  presetRule,
]

export const rolePermPutRules = [
  body('role_code').isString().notEmpty(),
  body('perm_codes').isArray().withMessage('perm_codes 必须为数组'),
]

export const requiredFieldsPutRules = [
  body('fields').isArray().withMessage('fields 必须为数组'),
  body('fields.*.field_key').isString().notEmpty().withMessage('field_key 必填'),
  body('fields.*.projects').optional().isArray().withMessage('projects 必须为数组'),
  body('fields.*.projects.*').optional().isString(),
]

export const idParam = (name = 'id') => param(name).isString().trim().notEmpty()
