// 只读元数据（见 docs/API契约.md 第 6 节）：主题/字段/统计维度/功能与字段说明
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { attachScope } from '../middleware/scope.js'
import { hasPerm } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { pool } from '../db/pool.js'
import { ok } from '../utils/resp.js'
import { issueExportLimitRules, defaultUserPasswordRules } from '../schemas/config.js'
import {
  getIssueExportLimit, setIssueExportLimit, getDefaultUserPassword, setDefaultUserPassword,
} from '../services/settings.js'

const router = Router()
router.use(authRequired)

const THEME_OPTIONS = [
  { key: 'ocean', label: '深空蓝', dark: true },
  { key: 'paper', label: '云白', dark: false },
  { key: 'warm', label: '暖砂', dark: false },
]

const STAT_DIMS = [
  { key: 'owner', label: '负责人', mode: 'person' },
  { key: 'developer', label: '开发人员', mode: 'person' },
  { key: 'project', label: '项目', mode: 'dict' },
  { key: 'status', label: '状态', mode: 'dict' },
  { key: 'module', label: '模块', mode: 'dict' },
  { key: 'priority', label: '优先级', mode: 'dict' },
  { key: 'type', label: '类型', mode: 'dict' },
]

// COLS（22 列）/ FIELDS（20 表单字段）—— 与原型一一对应
const COLS = [
  { key: 'seq', label: '序号', noFilter: true, virtual: true },
  { key: 'ops', label: '操作', noFilter: true, virtual: true },
  { key: 'logs', label: '修改日志', noFilter: true, virtual: true },
  { key: 'project', label: '项目' }, { key: 'stage', label: '阶段' }, { key: 'type', label: '类型' },
  { key: 'module', label: '模块' }, { key: 'desc', label: '需求描述' }, { key: 'priority', label: '优先级' },
  { key: 'impact', label: '影响程度' }, { key: 'reporter', label: '提出人' }, { key: 'reported_at', label: '提出日期' },
  { key: 'owner', label: '负责人' }, { key: 'plan_start', label: '预计开始' }, { key: 'plan_end', label: '预计完成' },
  { key: 'developer', label: '开发人员' }, { key: 'solution', label: '开发方案' }, { key: 'pending_test', label: '待测试' },
  { key: 'status', label: '状态' }, { key: 'resolved_at', label: '实际完成' },
  { key: 'customer_test', label: '客户测试' }, { key: 'customer_test_done', label: '客户测试完成' },
  { key: 'image_url', label: '图片' },
]

const FIELDS = [
  { key: 'project', label: '项目', required: true }, { key: 'stage', label: '阶段' }, { key: 'type', label: '类型' },
  { key: 'module', label: '模块' }, { key: 'desc', label: '需求描述' }, { key: 'priority', label: '优先级', required: true },
  { key: 'impact', label: '影响程度' }, { key: 'reporter', label: '提出人' }, { key: 'reported_at', label: '提出日期' },
  { key: 'owner', label: '负责人' }, { key: 'plan_start', label: '预计开始' }, { key: 'plan_end', label: '预计完成' },
  { key: 'developer', label: '开发人员' }, { key: 'solution', label: '开发方案' }, { key: 'track', label: '跟踪记录' },
  { key: 'pending_test', label: '待测试' }, { key: 'status', label: '状态', required: true },
  { key: 'resolved_at', label: '实际完成' }, { key: 'customer_test', label: '客户测试' },
  { key: 'customer_test_done', label: '客户测试完成' },
]

router.get('/', asyncHandler(async (_req, res) => ok(res, { themes: THEME_OPTIONS.map((t) => t.key) })))
router.get('/theme-options', asyncHandler(async (_req, res) => ok(res, THEME_OPTIONS)))
router.get('/stat-dims', asyncHandler(async (_req, res) => ok(res, STAT_DIMS)))

// 系统设置（SECURITY_MGR）：问题导出上限，0=不限制
router.get('/settings/issue-export-limit', loadProfile, attachScope, hasPerm('SECURITY_MGR'),
  asyncHandler(async (req, res) => ok(res, await getIssueExportLimit(req.query.project))))
router.put('/settings/issue-export-limit', loadProfile, attachScope, hasPerm('SECURITY_MGR'),
  issueExportLimitRules, validate,
  asyncHandler(async (req, res) => ok(res,
    await setIssueExportLimit(req.body.value, { projects: req.body.projects, id: req.body.id, req }))))

// 系统设置（SECURITY_MGR）：人员下推用户时的初始密码
router.get('/settings/default-user-password', loadProfile, attachScope, hasPerm('SECURITY_MGR'),
  asyncHandler(async (req, res) => ok(res, await getDefaultUserPassword(req.query.project))))
router.put('/settings/default-user-password', loadProfile, attachScope, hasPerm('SECURITY_MGR'),
  defaultUserPasswordRules, validate,
  asyncHandler(async (req, res) => ok(res,
    await setDefaultUserPassword(req.body.value, { projects: req.body.projects, id: req.body.id, req }))))

// COLS/FIELDS/字典/人员（前端渲染表单与表头的数据源，一次拉全）
// scope=1：首页等场景只返回当前用户可见项目及对应人员
router.get('/fields', loadProfile, attachScope, asyncHandler(async (req, res) => {
  const scoped = req.query.scope === '1'
  const scope = scoped ? req.scope : null
  // scope=null 不过滤；scope=[] 不可见任何项目专属数据（通用项仍可见）；数组=按项目过滤
  const arrCond = (col, idx = 1) => scope === null ? '' : (scope.length ? `AND ${col} = ANY($${idx}::text[])` : 'AND FALSE')
  const overlapCond = (col, idx = 1) => scope === null ? '' : (scope.length ? `AND ${col} && $${idx}::text[]` : 'AND FALSE')
  const sp = scope && scope.length ? [scope] : []
  const dict = await pool.query(
    `SELECT dict_key, value, label, color, note, product_code, project_code FROM dict_items
     WHERE enabled = true ${scope === null ? '' : (scope.length ? "AND (project_code='' OR project_code = ANY($1::text[]))" : "AND project_code=''")}
     ORDER BY dict_key, sort, id`, sp)
  const personnel = await pool.query(
    `SELECT p.code, p.name, p.role, r.name AS role_name, p."group", p.color, p.projects
     FROM personnel p LEFT JOIN roles r ON r.code = p.role
     WHERE p.enabled = true
       ${scope === null ? '' : (scope.length ? "AND (p.projects ? 'ALL' OR p.projects ?| $1::text[])" : 'AND FALSE')}
     ORDER BY p.code`, sp)
  const projects = await pool.query(
    `SELECT code, name, color FROM projects WHERE enabled = true ${arrCond('code')}
     ORDER BY code`, sp)
  const products = await pool.query(
    `SELECT code, note, color, projects FROM products WHERE enabled = true ${overlapCond('projects')}
     ORDER BY code`, sp)
  const customFields = await pool.query(
    `SELECT key, label, type, projects FROM custom_fields WHERE enabled = true ${overlapCond('projects')}
     ORDER BY key`, sp)
  const noticeTypes = await pool.query(
    `SELECT id, name, projects FROM notice_types WHERE enabled = true ${overlapCond('projects')}
     ORDER BY id`, sp)
  const todoPrios = await pool.query(
    `SELECT code, label, projects FROM todo_prios WHERE enabled = true ${overlapCond('projects')}
     ORDER BY code`, sp)
  const grouped = {}
  for (const r of dict.rows) (grouped[r.dict_key] ??= []).push(r)
  ok(res, {
    cols: COLS, fields: FIELDS, customFields: customFields.rows,
    dicts: grouped, personnel: personnel.rows, projects: projects.rows,
    products: products.rows, noticeTypes: noticeTypes.rows, todoPrios: todoPrios.rows,
  })
}))

// 功能与字段说明（只读聚合，随配置自动更新的对照清单）
router.get('/feature-doc', loadProfile, asyncHandler(async (_req, res) => {
  const counts = await pool.query(`
    SELECT (SELECT count(*) FROM projects) AS projects,
           (SELECT count(*) FROM products) AS products,
           (SELECT count(*) FROM personnel) AS personnel,
           (SELECT count(*) FROM dict_items) AS dict_items,
           (SELECT count(*) FROM custom_fields) AS custom_fields,
           (SELECT count(*) FROM required_fields) AS required_fields`)
  ok(res, {
    menus: [
      { key: 'home', label: '首页', perm: 'DASH_VIEW' },
      { key: 'issues', label: '问题跟踪', perm: 'ISSUE_VIEW' },
      { key: 'stats', label: '统计报表', perm: 'ISSUE_VIEW' },
      { key: 'archives', label: '基础档案设置', perm: 'ARCHIVE_MGR' },
      { key: 'security', label: '用户与权限', perm: 'SECURITY_MGR' },
    ],
    permsModule: '见 permissions 表（20 项权限位）',
    counts: counts.rows[0],
  })
}))

export default router
