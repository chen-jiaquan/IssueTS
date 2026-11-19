// 只读元数据（见 docs/API契约.md 第 6 节）：主题/字段/统计维度/功能与字段说明
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { pool } from '../db/pool.js'
import { ok } from '../utils/resp.js'
import { issueExportLimitRules } from '../schemas/config.js'
import { getIssueExportLimit, setIssueExportLimit } from '../services/settings.js'

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
router.get('/settings/issue-export-limit', loadProfile, hasPerm('SECURITY_MGR'),
  asyncHandler(async (_req, res) => ok(res, await getIssueExportLimit())))
router.put('/settings/issue-export-limit', loadProfile, hasPerm('SECURITY_MGR'),
  issueExportLimitRules, validate,
  asyncHandler(async (req, res) => ok(res, await setIssueExportLimit(req.body.value))))

// COLS/FIELDS/字典/人员（前端渲染表单与表头的数据源，一次拉全）
router.get('/fields', asyncHandler(async (_req, res) => {
  const dict = await pool.query(
    'SELECT dict_key, value, label, color, note, product_code FROM dict_items ORDER BY dict_key, sort, id')
  const personnel = await pool.query('SELECT code, name, role, "group", color FROM personnel ORDER BY code')
  const grouped = {}
  for (const r of dict.rows) (grouped[r.dict_key] ??= []).push(r)
  ok(res, { cols: COLS, fields: FIELDS, dicts: grouped, personnel: personnel.rows })
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
