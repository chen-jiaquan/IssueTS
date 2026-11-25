// 基础档案 / 用户与权限（见 docs/API契约.md 第 5 节）
// 档案数据为受限引用数据（字典/人员等供下拉全量使用），GET 不分页；
// 问题列表/日志等大数据集接口强制分页。
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm, systemAdminOnly } from '../middleware/rbac.js'
import { attachScope, assertProjectsEditable } from '../middleware/scope.js'
import * as S from '../services/archives.js'
import * as X from '../services/excel.js'
import {
  userRules, roleRules, permRules, projectRules, productRules, personnelRules,
  dictItemRules, customFieldRules, noticeTypeRules, todoPrioRules,
  alertRulePutRules, rolePermPutRules, requiredFieldsPutRules,
} from '../schemas/archives.js'
import { ok, HttpError, ERR } from '../utils/resp.js'

const router = Router()
router.use(authRequired, loadProfile, attachScope)

const guard = (perm) => [hasPerm(perm)]
// 二级菜单权限（一级总权限已移除，统一按页签级权限位鉴权）。
const P = {
  ARCHIVE_PROJECTS: ['ARCHIVE_TAB_PROJECTS'],
  ARCHIVE_PRODUCTS: ['ARCHIVE_TAB_PRODUCTS'],
  ARCHIVE_PERSONNEL: ['ARCHIVE_TAB_PERSONNEL'],
  ARCHIVE_DICT: ['ARCHIVE_TAB_DICT'],
  ARCHIVE_CUSTOM: ['ARCHIVE_TAB_CUSTOM_FIELDS'],
  ARCHIVE_REQUIRED: ['ARCHIVE_TAB_REQUIRED_FIELDS'],
  ARCHIVE_NOTICE_TYPES: ['ARCHIVE_TAB_NOTICE_TYPES'],
  ARCHIVE_TODO_PRIOS: ['ARCHIVE_TAB_TODO_PRIOS'],
  SECURITY_USERS: ['SECURITY_TAB_USERS'],
  SECURITY_ROLES: ['SECURITY_TAB_ROLES'],
  SECURITY_ROLES_WRITE: ['SECURITY_TAB_ROLES'],
  // 权限字典为只读公共数据：权限位/角色/角色权限页签均需加载；写操作仍限权限位页签。
  SECURITY_PERMISSIONS: ['SECURITY_TAB_PERMISSIONS', 'SECURITY_TAB_ROLES', 'SECURITY_TAB_MATRIX'],
  SECURITY_PERMISSIONS_WRITE: ['SECURITY_TAB_PERMISSIONS'],
  SECURITY_MATRIX: ['SECURITY_TAB_MATRIX'],
  SECURITY_ALERTS: ['DASH_ALERT', 'SECURITY_TAB_ALERTS'],
}
const idOf = (req) => req.params.id
const fieldModuleOf = (req) => {
  const m = req.query.module ?? 'issue'
  if (m !== 'issue' && m !== 'plan') {
    throw new HttpError(400, ERR.VALIDATION, '所属类型须为 issue 或 plan')
  }
  return m
}
const checkBodyProjects = (req, _res, next) => {
  try { assertProjectsEditable(req, req.body?.projects); next() } catch (e) { next(e) }
}

// ---------- 用户 ----------
router.get('/users', guard(P.SECURITY_USERS), asyncHandler(async (req, res) => ok(res, await S.listUsers(req.scope, req.query.project, req))))
router.post('/users', guard(P.SECURITY_USERS), userRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createUser(req.body, req))))
router.put('/users/:id', guard(P.SECURITY_USERS), userRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateUser(idOf(req), req.body, req))))
router.delete('/users/:id', guard(P.SECURITY_USERS), asyncHandler(async (req, res) => { await S.removeUser(idOf(req)); ok(res) }))

// ---------- 角色 / 权限 ----------
router.get('/roles', guard(P.SECURITY_ROLES), asyncHandler(async (req, res) => ok(res, await S.listRoles(req.scope, req.query.project))))
router.post('/roles', guard(P.SECURITY_ROLES_WRITE), roleRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createRole(req.body, req))))
router.put('/roles/:code', guard(P.SECURITY_ROLES_WRITE), roleRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateRole(req.params.code, req.body, req))))
router.delete('/roles/:code', guard(P.SECURITY_ROLES_WRITE), asyncHandler(async (req, res) => { await S.removeRole(req.params.code); ok(res) }))

// 权限位列表供角色/矩阵页签加载下拉与展示，保持可读；写操作收敛为仅系统管理员角色。
router.get('/permissions', guard(P.SECURITY_PERMISSIONS), asyncHandler(async (req, res) => ok(res, await S.listPermissions())))
router.post('/permissions', systemAdminOnly, guard(P.SECURITY_PERMISSIONS_WRITE), permRules(false), validate, asyncHandler(async (req, res) => ok(res, await S.createPermission(req.body))))
router.put('/permissions/:code', systemAdminOnly, guard(P.SECURITY_PERMISSIONS_WRITE), permRules(true), validate, asyncHandler(async (req, res) => ok(res, await S.updatePermission(req.params.code, req.body))))
router.delete('/permissions/:code', systemAdminOnly, guard(P.SECURITY_PERMISSIONS_WRITE), asyncHandler(async (req, res) => { await S.removePermission(req.params.code); ok(res) }))

// ---------- 权限分配矩阵 ----------
router.get('/role-permissions', guard(P.SECURITY_MATRIX), asyncHandler(async (req, res) => ok(res, await S.getRolePerms(req.scope, req.query.project))))
router.put('/role-permissions', guard(P.SECURITY_MATRIX), rolePermPutRules, validate, asyncHandler(async (req, res) =>
  ok(res, await S.putRolePerms(req.body.role_code, req.body.perm_codes, req.profile, req.scope))))

// ---------- 项目 / 产品 / 人员 ----------
// 默认只返回已生效项目；includePending=1 供档案页展示申请中/已拒绝记录
router.get('/projects', asyncHandler(async (req, res) => ok(res, await S.listProjects(req.scope,
  req.query.includePending === '1' || req.query.include_pending === '1')))) // 按可见项目过滤
router.post('/projects', guard(P.ARCHIVE_PROJECTS), projectRules, validate, asyncHandler(async (req, res) => ok(res, await S.createProject(req.body))))
router.put('/projects/:id', guard(P.ARCHIVE_PROJECTS), projectRules, validate, asyncHandler(async (req, res) => ok(res, await S.updateProject(req.params.id, req.body, req))))
router.delete('/projects/:id', guard(P.ARCHIVE_PROJECTS), asyncHandler(async (req, res) => { await S.removeProject(req.params.id); ok(res) }))

router.get('/products', attachScope, asyncHandler(async (req, res) => ok(res, await S.listProducts(req.scope))))
router.post('/products', guard(P.ARCHIVE_PRODUCTS), productRules, validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createProduct(req.body))))
router.put('/products/:id', guard(P.ARCHIVE_PRODUCTS), productRules, validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateProduct(req.params.id, req.body))))
router.delete('/products/:id', guard(P.ARCHIVE_PRODUCTS), asyncHandler(async (req, res) => { await S.removeProduct(req.params.id); ok(res) }))

router.get('/personnel', asyncHandler(async (req, res) => ok(res, await S.listPersonnel(req.scope))))

// 人员档案 Excel 导入/导出
router.get('/personnel/import/fields', guard(P.ARCHIVE_PERSONNEL),
  asyncHandler(async (_req, res) => ok(res, X.personnelImportFields())))
router.post('/personnel/import/headers', guard(P.ARCHIVE_PERSONNEL), X.uploadSingle,
  asyncHandler(async (req, res) => ok(res, { headers: await X.readHeaders(req.file.buffer) })))
router.post('/personnel/import', guard(P.ARCHIVE_PERSONNEL), X.uploadSingle,
  asyncHandler(async (req, res) => {
    let mapping = req.body?.mapping
    if (typeof mapping === 'string') {
      try { mapping = JSON.parse(mapping) } catch { mapping = null }
    }
    const result = await X.importPersonnelExcel(req.file.buffer, req, mapping)
    console.log(`[personnel-import] ${req.profile.username} 成功=${result.imported} 失败=${result.failed} 清单=${result.failUrl || '-'}`)
    ok(res, result)
  }))
router.get('/personnel/export', guard(P.ARCHIVE_PERSONNEL),
  asyncHandler(async (_req, res) => {
    const buf = await X.exportPersonnelExcel()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="personnel-${Date.now()}.xlsx"`)
    res.send(buf)
  }))

router.post('/personnel', guard(P.ARCHIVE_PERSONNEL), personnelRules(false), validate, asyncHandler(async (req, res) => ok(res, await S.createPersonnel(req.body, req))))
router.put('/personnel/:id', guard(P.ARCHIVE_PERSONNEL), personnelRules(true), validate, asyncHandler(async (req, res) => ok(res, await S.updatePersonnel(req.params.id, req.body, req))))
router.delete('/personnel/:id', guard(P.ARCHIVE_PERSONNEL), asyncHandler(async (req, res) => { await S.removePersonnel(req.params.id); ok(res) }))

// ---------- 字典项 ----------
router.get('/dict-items', asyncHandler(async (req, res) => ok(res, await S.listDictItems(req.query.dict_key, req.scope))))
router.post('/dict-items', guard(P.ARCHIVE_DICT), dictItemRules(false), validate, asyncHandler(async (req, res) => ok(res, await S.createDictItem(req.body))))
router.put('/dict-items/:id', guard(P.ARCHIVE_DICT), dictItemRules(true), validate, asyncHandler(async (req, res) => ok(res, await S.updateDictItem(idOf(req), req.body))))
router.delete('/dict-items/:id', guard(P.ARCHIVE_DICT), asyncHandler(async (req, res) => { await S.removeDictItem(idOf(req)); ok(res) }))

// ---------- 自定义字段 / 必填字段 ----------
router.get('/custom-fields', attachScope, asyncHandler(async (req, res) => ok(res, await S.listCustomFields(req.scope))))
router.post('/custom-fields', guard(P.ARCHIVE_CUSTOM), customFieldRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createCustomField(req.body))))
router.put('/custom-fields/:id', guard(P.ARCHIVE_CUSTOM), customFieldRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateCustomField(req.params.id, req.body))))
router.delete('/custom-fields/:id', guard(P.ARCHIVE_CUSTOM), asyncHandler(async (req, res) => { await S.removeCustomField(req.params.id); ok(res) }))

router.get('/required-fields', asyncHandler(async (req, res) => ok(res, await S.getRequiredFields(req.query.project, fieldModuleOf(req)))))
router.get('/required-fields/rules', guard(P.ARCHIVE_REQUIRED), asyncHandler(async (req, res) => ok(res, await S.getRequiredFieldRules(req.scope, fieldModuleOf(req)))))
router.put('/required-fields', guard(P.ARCHIVE_REQUIRED), requiredFieldsPutRules, validate, asyncHandler(async (req, res) =>
  ok(res, await S.putRequiredFields(req.body.fields, req, req.query.project, fieldModuleOf(req)))))

// ---------- 通知类型 / 待办优先级 ----------
router.get('/notice-types', attachScope, asyncHandler(async (req, res) => ok(res, await S.listNoticeTypes(req.scope))))
router.post('/notice-types', guard(P.ARCHIVE_NOTICE_TYPES), noticeTypeRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createNoticeType(req.body))))
router.put('/notice-types/:id', guard(P.ARCHIVE_NOTICE_TYPES), noticeTypeRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateNoticeType(idOf(req), req.body))))
router.delete('/notice-types/:id', guard(P.ARCHIVE_NOTICE_TYPES), asyncHandler(async (req, res) => { await S.removeNoticeType(idOf(req)); ok(res) }))

router.get('/todo-prios', attachScope, asyncHandler(async (req, res) => ok(res, await S.listTodoPrios(req.scope))))
router.post('/todo-prios', guard(P.ARCHIVE_TODO_PRIOS), todoPrioRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createTodoPrio(req.body))))
router.put('/todo-prios/:id', guard(P.ARCHIVE_TODO_PRIOS), todoPrioRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateTodoPrio(req.params.id, req.body))))
router.delete('/todo-prios/:id', guard(P.ARCHIVE_TODO_PRIOS), asyncHandler(async (req, res) => { await S.removeTodoPrio(req.params.id); ok(res) }))

// ---------- 预警规则 ----------
router.get('/alert-rules', guard(P.SECURITY_ALERTS), asyncHandler(async (req, res) => ok(res, await S.listAlertRules())))
router.put('/alert-rules', guard(P.SECURITY_ALERTS), alertRulePutRules, validate, asyncHandler(async (req, res) => ok(res, await S.putAlertRule(req.body))))

export default router
