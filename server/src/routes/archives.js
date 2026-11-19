// 基础档案 / 用户与权限（见 docs/API契约.md 第 5 节）
// 档案数据为受限引用数据（字典/人员等供下拉全量使用），GET 不分页；
// 问题列表/日志等大数据集接口强制分页。
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { attachScope, assertProjectsEditable } from '../middleware/scope.js'
import * as S from '../services/archives.js'
import * as X from '../services/excel.js'
import {
  userRules, roleRules, permRules, projectRules, productRules, personnelRules,
  dictItemRules, customFieldRules, noticeTypeRules, todoPrioRules,
  alertRulePutRules, rolePermPutRules, requiredFieldsPutRules,
} from '../schemas/archives.js'
import { ok } from '../utils/resp.js'

const router = Router()
router.use(authRequired, loadProfile, attachScope)

const guard = (perm) => [hasPerm(perm)]
const idOf = (req) => req.params.id
const checkBodyProjects = (req, _res, next) => {
  try { assertProjectsEditable(req, req.body?.projects); next() } catch (e) { next(e) }
}
const checkRequiredFieldsProjects = (req, _res, next) => {
  try {
    for (const f of req.body?.fields || []) assertProjectsEditable(req, f.projects)
    next()
  } catch (e) { next(e) }
}

// ---------- 用户（SECURITY_MGR） ----------
router.get('/users', guard('SECURITY_MGR'), asyncHandler(async (req, res) => ok(res, await S.listUsers(req.scope, req.query.project))))
router.post('/users', guard('SECURITY_MGR'), userRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createUser(req.body, req))))
router.put('/users/:id', guard('SECURITY_MGR'), userRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateUser(idOf(req), req.body, req))))
router.delete('/users/:id', guard('SECURITY_MGR'), asyncHandler(async (req, res) => { await S.removeUser(idOf(req)); ok(res) }))

// ---------- 角色 / 权限 ----------
router.get('/roles', guard(['ARCHIVE_MGR', 'SECURITY_MGR']), asyncHandler(async (req, res) => ok(res, await S.listRoles(req.scope, req.query.project))))
router.post('/roles', guard('ARCHIVE_MGR'), roleRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createRole(req.body, req))))
router.put('/roles/:code', guard('ARCHIVE_MGR'), roleRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateRole(req.params.code, req.body, req))))
router.delete('/roles/:code', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => { await S.removeRole(req.params.code); ok(res) }))

router.get('/permissions', guard(['ARCHIVE_MGR', 'SECURITY_MGR']), asyncHandler(async (req, res) => ok(res, await S.listPermissions())))
router.post('/permissions', guard('ARCHIVE_MGR'), permRules(false), validate, asyncHandler(async (req, res) => ok(res, await S.createPermission(req.body))))
router.put('/permissions/:code', guard('ARCHIVE_MGR'), permRules(true), validate, asyncHandler(async (req, res) => ok(res, await S.updatePermission(req.params.code, req.body))))
router.delete('/permissions/:code', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => { await S.removePermission(req.params.code); ok(res) }))

// ---------- 权限分配矩阵（SECURITY_MGR） ----------
router.get('/role-permissions', guard('SECURITY_MGR'), asyncHandler(async (req, res) => ok(res, await S.getRolePerms(req.scope, req.query.project))))
router.put('/role-permissions', guard('SECURITY_MGR'), rolePermPutRules, validate, asyncHandler(async (req, res) =>
  ok(res, await S.putRolePerms(req.body.role_code, req.body.perm_codes))))

// ---------- 项目 / 产品 / 人员 ----------
router.get('/projects', asyncHandler(async (req, res) => ok(res, await S.listProjects(req.scope)))) // 按可见项目过滤
router.post('/projects', guard('ARCHIVE_MGR'), projectRules, validate, asyncHandler(async (req, res) => ok(res, await S.createProject(req.body))))
router.put('/projects/:id', guard('ARCHIVE_MGR'), projectRules, validate, asyncHandler(async (req, res) => ok(res, await S.updateProject(req.params.id, req.body))))
router.delete('/projects/:id', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => { await S.removeProject(req.params.id); ok(res) }))

router.get('/products', attachScope, asyncHandler(async (req, res) => ok(res, await S.listProducts(req.scope))))
router.post('/products', guard('ARCHIVE_MGR'), productRules, validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createProduct(req.body))))
router.put('/products/:id', guard('ARCHIVE_MGR'), productRules, validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateProduct(req.params.id, req.body))))
router.delete('/products/:id', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => { await S.removeProduct(req.params.id); ok(res) }))

router.get('/personnel', asyncHandler(async (req, res) => ok(res, await S.listPersonnel(req.scope))))

// 人员档案 Excel 导入/导出（ARCHIVE_MGR）
router.get('/personnel/import/fields', guard('ARCHIVE_MGR'),
  asyncHandler(async (_req, res) => ok(res, X.personnelImportFields())))
router.post('/personnel/import/headers', guard('ARCHIVE_MGR'), X.uploadSingle,
  asyncHandler(async (req, res) => ok(res, { headers: await X.readHeaders(req.file.buffer) })))
router.post('/personnel/import', guard('ARCHIVE_MGR'), X.uploadSingle,
  asyncHandler(async (req, res) => {
    let mapping = req.body?.mapping
    if (typeof mapping === 'string') {
      try { mapping = JSON.parse(mapping) } catch { mapping = null }
    }
    const result = await X.importPersonnelExcel(req.file.buffer, req, mapping)
    console.log(`[personnel-import] ${req.profile.username} 成功=${result.imported} 失败=${result.failed} 清单=${result.failUrl || '-'}`)
    ok(res, result)
  }))
router.get('/personnel/export', guard('ARCHIVE_MGR'),
  asyncHandler(async (_req, res) => {
    const buf = await X.exportPersonnelExcel()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="personnel-${Date.now()}.xlsx"`)
    res.send(buf)
  }))

router.post('/personnel', guard('ARCHIVE_MGR'), personnelRules(false), validate, asyncHandler(async (req, res) => ok(res, await S.createPersonnel(req.body))))
router.put('/personnel/:id', guard('ARCHIVE_MGR'), personnelRules(true), validate, asyncHandler(async (req, res) => ok(res, await S.updatePersonnel(req.params.id, req.body))))
router.delete('/personnel/:id', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => { await S.removePersonnel(req.params.id); ok(res) }))

// ---------- 字典项 ----------
router.get('/dict-items', asyncHandler(async (req, res) => ok(res, await S.listDictItems(req.query.dict_key, req.scope))))
router.post('/dict-items', guard('ARCHIVE_MGR'), dictItemRules(false), validate, asyncHandler(async (req, res) => ok(res, await S.createDictItem(req.body))))
router.put('/dict-items/:id', guard('ARCHIVE_MGR'), dictItemRules(true), validate, asyncHandler(async (req, res) => ok(res, await S.updateDictItem(idOf(req), req.body))))
router.delete('/dict-items/:id', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => { await S.removeDictItem(idOf(req)); ok(res) }))

// ---------- 自定义字段 / 必填字段 ----------
router.get('/custom-fields', attachScope, asyncHandler(async (req, res) => ok(res, await S.listCustomFields(req.scope))))
router.post('/custom-fields', guard('ARCHIVE_MGR'), customFieldRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createCustomField(req.body))))
router.put('/custom-fields/:id', guard('ARCHIVE_MGR'), customFieldRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateCustomField(req.params.id, req.body))))
router.delete('/custom-fields/:id', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => { await S.removeCustomField(req.params.id); ok(res) }))

router.get('/required-fields', asyncHandler(async (req, res) => ok(res, await S.getRequiredFields(req.query.project))))
router.get('/required-fields/rules', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => ok(res, await S.getRequiredFieldRules())))
router.put('/required-fields', guard('ARCHIVE_MGR'), requiredFieldsPutRules, validate, checkRequiredFieldsProjects, asyncHandler(async (req, res) =>
  ok(res, await S.putRequiredFields(req.body.fields))))

// ---------- 通知类型 / 待办优先级 ----------
router.get('/notice-types', attachScope, asyncHandler(async (req, res) => ok(res, await S.listNoticeTypes(req.scope))))
router.post('/notice-types', guard('ARCHIVE_MGR'), noticeTypeRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createNoticeType(req.body))))
router.put('/notice-types/:id', guard('ARCHIVE_MGR'), noticeTypeRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateNoticeType(idOf(req), req.body))))
router.delete('/notice-types/:id', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => { await S.removeNoticeType(idOf(req)); ok(res) }))

router.get('/todo-prios', attachScope, asyncHandler(async (req, res) => ok(res, await S.listTodoPrios(req.scope))))
router.post('/todo-prios', guard('ARCHIVE_MGR'), todoPrioRules(false), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.createTodoPrio(req.body))))
router.put('/todo-prios/:id', guard('ARCHIVE_MGR'), todoPrioRules(true), validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.updateTodoPrio(req.params.id, req.body))))
router.delete('/todo-prios/:id', guard('ARCHIVE_MGR'), asyncHandler(async (req, res) => { await S.removeTodoPrio(req.params.id); ok(res) }))

// ---------- 预警规则（DASH_ALERT） ----------
router.get('/alert-rules', guard('DASH_ALERT'), asyncHandler(async (req, res) => ok(res, await S.listAlertRules(req.scope, req.query.project))))
router.put('/alert-rules', guard('DASH_ALERT'), alertRulePutRules, validate, checkBodyProjects, asyncHandler(async (req, res) => ok(res, await S.putAlertRule(req.body, req))))

export default router
