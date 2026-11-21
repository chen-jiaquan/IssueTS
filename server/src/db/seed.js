// 种子数据：字典/权限/角色/用户/项目/产品/人员/通知/待办/预警规则
// 数据源自原型 v29 的 ROLES/PERMS/USERS/PROJECTS/PRODUCTS/PERSONNEL/DICTS/NOTICES/TODOS/ALERT_RULES
// （见 docs/数据模型.md 第 6 节与原型 HTML）。幂等：重复执行使用 UPSERT。
// 用户密码 bcrypt 哈希存储（原型明文仅演示）。
import bcrypt from 'bcryptjs'
import { pool } from './pool.js'

// ---------- 角色 ----------
const ROLES = [
  { code: 'R01', name: '管理员', desc: '系统最高权限', color: '#ef4444', external: false, preset: true },
  { code: 'R02', name: '项目经理', desc: '项目与交付统筹', color: '#a371f7', external: false, preset: true },
  { code: 'R03', name: '交付顾问', desc: '内部实施与验证', color: '#4c9aff', external: false, preset: true },
  { code: 'R04', name: '开发人员', desc: '问题修复与方案', color: '#d29922', external: false, preset: true },
  { code: 'R05', name: '客户测试人员', desc: '外部 · 提单与复测', color: '#22c55e', external: true, preset: true },
]

// ---------- 权限（32 项），allow=默认授权角色名 ----------
const PERMS = [
  { code: 'DASH_VIEW', module: '工作台', name: '查看首页看板', desc: '核心信息/预警/通知/待办', allow: ['管理员', '项目经理', '交付顾问', '开发人员', '客户测试人员'] },
  { code: 'DASH_NOTICE', module: '工作台', name: '管理通知消息', desc: '通知新增/改/删', allow: ['管理员', '项目经理'] },
  { code: 'DASH_TODO', module: '工作台', name: '管理待办事项', desc: '待办增删改与完成', allow: ['管理员', '项目经理', '交付顾问', '开发人员', '客户测试人员'] },
  { code: 'DASH_ALERT', module: '工作台', name: '配置预警规则', desc: '规则开关与阈值', allow: ['管理员', '项目经理'], no_assign: true },
  { code: 'ISSUE_VIEW', module: '问题管理', name: '查看问题列表', desc: '只读查看', allow: ['管理员', '项目经理', '交付顾问', '开发人员', '客户测试人员'] },
  { code: 'ISSUE_CREATE', module: '问题管理', name: '登记新问题', desc: '创建问题', allow: ['管理员', '项目经理', '交付顾问', '客户测试人员'] },
  { code: 'ISSUE_EDIT', module: '问题管理', name: '编辑全部字段', desc: '修改任意问题', allow: ['管理员', '项目经理', '交付顾问'] },
  { code: 'ISSUE_ASSIGN', module: '问题管理', name: '分派负责人', desc: '指派处理人', allow: ['管理员', '项目经理', '交付顾问'] },
  { code: 'ISSUE_SOLUTION', module: '问题管理', name: '填写开发方案', desc: '修复方案与跟踪', allow: ['管理员', '项目经理', '开发人员'] },
  { code: 'ISSUE_VERIFY', module: '问题管理', name: '顾问验证', desc: '标记待测试', allow: ['管理员', '项目经理', '交付顾问'] },
  { code: 'ISSUE_RETEST', module: '问题管理', name: '客户复测', desc: '客户验证并反馈', allow: ['管理员', '项目经理', '客户测试人员'] },
  { code: 'ISSUE_CLOSE', module: '问题管理', name: '关闭 / reopen', desc: '终态与重开', allow: ['管理员', '项目经理', '交付顾问', '客户测试人员'] },
  { code: 'ISSUE_DELETE', module: '问题管理', name: '删除问题', desc: '整行删除', allow: ['管理员', '项目经理'] },
  { code: 'ISSUE_BATCH', module: '问题管理', name: '批量行内修改', desc: '勾选多行后在表内直接编辑', allow: ['管理员', '项目经理', '交付顾问'] },
  { code: 'ISSUE_IMPORT', module: '问题管理', name: '导入 Excel', desc: '导入并替换问题列表', allow: ['管理员', '项目经理'] },
  { code: 'ISSUE_LOG', module: '问题管理', name: '查看修改日志', desc: '列表独立列 / 详情卡片 / 工具栏全局查询，字段级留痕', allow: ['管理员', '项目经理', '交付顾问', '开发人员'] },
  // 基础档案：按界面二级菜单（页签）细化
  { code: 'ARCHIVE_TAB_PROJECTS', module: '基础档案', name: '二级菜单·项目', desc: '基础档案-项目页签', allow: ['管理员', '项目经理'] },
  { code: 'ARCHIVE_TAB_PRODUCTS', module: '基础档案', name: '二级菜单·产品', desc: '基础档案-产品页签', allow: ['管理员', '项目经理'] },
  { code: 'ARCHIVE_TAB_PERSONNEL', module: '基础档案', name: '二级菜单·人员', desc: '基础档案-人员页签', allow: ['管理员', '项目经理'] },
  { code: 'ARCHIVE_TAB_DICT', module: '基础档案', name: '二级菜单·字典', desc: '基础档案-字典页签', allow: ['管理员', '项目经理'] },
  { code: 'ARCHIVE_TAB_CUSTOM_FIELDS', module: '基础档案', name: '二级菜单·自定义字段', desc: '基础档案-自定义字段页签', allow: ['管理员', '项目经理'] },
  { code: 'ARCHIVE_TAB_NOTICE_TYPES', module: '基础档案', name: '二级菜单·通知类型', desc: '基础档案-通知类型页签', allow: ['管理员', '项目经理'] },
  { code: 'ARCHIVE_TAB_TODO_PRIOS', module: '基础档案', name: '二级菜单·待办优先级', desc: '基础档案-待办优先级页签', allow: ['管理员', '项目经理'] },
  { code: 'ARCHIVE_TAB_REQUIRED_FIELDS', module: '基础档案', name: '二级菜单·必填字段', desc: '基础档案-必填字段页签', allow: ['管理员', '项目经理'] },
  // 用户与权限：按界面二级菜单（页签）细化
  { code: 'SECURITY_TAB_USERS', module: '用户与权限', name: '二级菜单·用户管理', desc: '用户与权限-用户管理页签', allow: ['管理员', '项目经理'] },
  { code: 'SECURITY_TAB_ROLES', module: '用户与权限', name: '二级菜单·角色', desc: '用户与权限-角色页签', allow: ['管理员', '项目经理'] },
  { code: 'SECURITY_TAB_PERMISSIONS', module: '用户与权限', name: '二级菜单·权限位', desc: '用户与权限-权限位页签', allow: ['管理员', '项目经理'], no_assign: true },
  { code: 'SECURITY_TAB_MATRIX', module: '用户与权限', name: '二级菜单·角色权限', desc: '用户与权限-角色权限页签', allow: ['管理员', '项目经理'] },
  { code: 'SECURITY_TAB_ALERTS', module: '用户与权限', name: '二级菜单·预警规则', desc: '用户与权限-预警规则页签', allow: ['管理员', '项目经理'], no_assign: true },
  { code: 'SECURITY_TAB_SETTINGS', module: '用户与权限', name: '二级菜单·系统设置', desc: '用户与权限-系统设置页签', allow: ['管理员'], no_assign: false },
  { code: 'DATA_EXPORT', module: '数据统计', name: '导出数据', desc: '问题列表与统计报表导出 Excel', allow: ['管理员', '项目经理', '交付顾问'] },
  { code: 'PROJECT_ALL', module: '数据统计', name: '查看全部项目', desc: '跨项目汇总', allow: ['管理员', '项目经理'] },
]

// ---------- 用户（密码明文仅用于哈希计算，不落库） ----------
const USERS = [
  { username: 'admin', password: 'Admin@2026', person: '系统管理员', role: '管理员', status: '启用', projects: 'ALL', preset: true },
  { username: 'pm.zhang', password: 'Pm@123456', person: '张晓林', personnelCode: 'P003', role: '项目经理', status: '启用', projects: 'DMS-2026,CTC-2026' },
  { username: 'liu.xingyu', password: 'Liu@2026', person: '刘星宇', personnelCode: 'P001', role: '交付顾问', status: '启用', projects: 'CTC-2026' },
  { username: 'chen.yongk', password: 'Chen@2026', person: '陈永侃', personnelCode: 'P002', role: '交付顾问', status: '启用', projects: 'DMS-2026' },
  { username: 'chen.chao', password: 'Dev@2026', person: '陈超', personnelCode: 'P004', role: '开发人员', status: '启用', projects: 'DMS-2026' },
  { username: 'yang.zhih', password: 'Dev@8888', person: '杨志豪', personnelCode: 'P005', role: '开发人员', status: '停用', projects: 'DMS-2026' },
  { username: 'wenqian', password: 'Test@2026', person: 'wenqian', role: '客户测试人员', status: '启用', projects: 'DMS-2026' },
  { username: 'adele', password: 'Test@2026', person: 'Adele', role: '客户测试人员', status: '启用', projects: 'DMS-2026' },
  { username: 'sally', password: 'Test@2026', person: 'sally', role: '客户测试人员', status: '启用', projects: 'DMS-2026' },
]

// ---------- 项目 / 产品 / 人员 ----------
const PROJECTS = [
  { code: 'DMS-2026', name: '默沙东 DMS 系统 2026 实施', note: '覆盖经销商、订单、价格与主数据等核心模块', color: '#4c9aff' },
  { code: 'CTC-2026', name: '年度质量体系调查专项', note: '客户调查表、样本管理与质量体系 UAT', color: '#a371f7' },
]

const PRODUCTS = [
  { code: 'DMS', note: '经销商管理系统', color: '#4c9aff' },
  { code: 'CMS', note: '内容 / 价格政策管理', color: '#a371f7' },
  { code: 'CTC 质量平台', note: '年度质量体系调查', color: '#22c55e' },
]

const PERSONNEL = [
  { code: 'P001', name: '刘星宇', role: 'R03', group: '质量体系组', color: '#4c9aff', projects: ['ALL'] },
  { code: 'P002', name: '陈永侃', role: 'R03', group: '价格管理组', color: '#a371f7', projects: ['DMS-2026'] },
  { code: 'P003', name: '张晓林', role: 'R03', group: '主数据组', color: '#22c55e', projects: ['DMS-2026', 'CTC-2026'] },
  { code: 'P004', name: '陈超', role: 'R04', group: '研发中心', color: '#d29922', projects: ['DMS-2026'] },
  { code: 'P005', name: '杨志豪', role: 'R04', group: '研发中心', color: '#ef4444', projects: ['DMS-2026'] },
  { code: 'C001', name: 'wenqian', role: 'R05', group: '客户测试组', color: '#58a6ff', projects: ['DMS-2026'] },
  { code: 'C002', name: 'Adele', role: 'R05', group: '客户测试组', color: '#3b82f6', projects: ['DMS-2026'] },
  { code: 'C003', name: 'sally', role: 'R05', group: '客户测试组', color: '#bc8cff', projects: ['DMS-2026'] },
]

// ---------- 数据字典（dict_key: stage/type/module/priority/impact/status/pending_test/customer_test） ----------
const DICTS = {
  stage: [
    { v: '第一轮UAT', color: '#4c9aff', note: '第一轮用户验收测试' },
    { v: '第二轮UAT', color: '#a371f7', note: '第二轮用户验收测试' },
    { v: '经销商&商务二轮UAT', color: '#d29922', note: '经销商与商务二轮 UAT' },
  ],
  type: [
    { v: '问题', color: '#4c9aff', note: '功能或界面问题' },
    { v: '需求', color: '#a371f7', note: '新增 / 变更需求' },
    { v: 'BUG', color: '#ef4444', note: '系统缺陷' },
    { v: 'reopen', color: '#d29922', note: '复测未通过重开（建议归入状态）' },
  ],
  module: [
    { v: '主数据', product: 'DMS', color: '#4c9aff' },
    { v: '订单（订单+意向单）', product: 'DMS', color: '#a371f7' },
    { v: '资料共享管理', product: 'DMS', color: '#22c55e' },
    { v: '折让+经销商审计', product: 'DMS', color: '#d29922' },
    { v: '报表管理', product: 'DMS', color: '#ef4444' },
    { v: '退货（退货+换货）', product: 'DMS', color: '#58a6ff' },
    { v: '年度质量体系调查', product: 'CTC 质量平台', color: '#bc8cff' },
    { v: '0.5期', product: 'DMS', color: '#56d364' },
    { v: '流向导入', product: 'DMS', color: '#e3b341' },
    { v: '价格管理-出厂价格', product: 'CMS', color: '#ff7b72' },
    { v: '平台通用类', product: 'DMS', color: '#3b82f6' },
    { v: '分货控货零头箱', product: 'DMS', color: '#d2a8ff' },
    { v: '数据迁移', product: 'DMS', color: '#7ee787' },
  ],
  priority: [
    { v: 'C', color: '#ef4444', note: '关键 Critical' },
    { v: 'H', color: '#d29922', note: '高 High' },
    { v: 'M', color: '#4c9aff', note: '中 Medium' },
    { v: 'L', color: '#6e7b8b', note: '低 Low' },
  ],
  impact: [
    { v: '大', color: '#ef4444', note: '大面积阻塞' },
    { v: '中', color: '#d29922', note: '部分受影响' },
    { v: '小', color: '#6e7b8b', note: '局部 / 个别' },
  ],
  status: [
    { v: '未开始', color: '#6e7b8b' },
    { v: '进行中', color: '#4c9aff' },
    { v: '已解决', color: '#22c55e' },
    { v: '关闭', color: '#6e7b8b' },
    { v: '暂停', color: '#d29922' },
  ],
  pending_test: [
    { v: '是', color: '#d29922' },
    { v: '否', color: '#6e7b8b' },
  ],
  customer_test: [
    { v: '是', color: '#4c9aff' },
    { v: '否', color: '#6e7b8b' },
  ],
}

// ---------- 工作台配置 ----------
const NOTICE_TYPES = ['通知', '公告', '提醒']

const TODO_PRIOS = [
  { code: 'C', label: '关键 Critical' },
  { code: 'H', label: '高 High' },
  { code: 'M', label: '中 Medium' },
  { code: 'L', label: '低 Low' },
]

const NOTICES = [
  { id: 'n1', type: '公告', title: 'UAT 第二轮测试将于 2026-11-20 启动', content: '请各模块负责人提前完成第一轮遗留问题的回归，并提交测试计划。', date: '2026-11-10', pinned: true, projects: ['CTC-2026', 'DMS-2026'] },
  { id: 'n2', type: '提醒', title: 'DMS 价格管理模块待客户复测', content: 'P001 价格管理-出厂价格 共 3 条已解决问题等待 wenqian 复测确认。', date: '2026-11-08', pinned: false, projects: ['DMS-2026'] },
  { id: 'n3', type: '通知', title: '质量体系调查模板字段已更新', content: '「许可经营地址」字段文案已修正，请按最新模板录入。', date: '2026-11-05', pinned: false, projects: ['CTC-2026'] },
]

const TODOS = [
  { id: 't1', text: '跟进 CTC 年度质量体系调查 5 条暂停问题的重启评估', owner: '刘星宇', due: '2026-11-15', prio: 'H', done: false },
  { id: 't2', text: '输出 DMS 主数据模块第二轮 UAT 用例', owner: '陈永侃', due: '2026-11-18', prio: 'M', done: false },
  { id: 't3', text: '确认客户测试账号权限范围（只读 / 复测）', owner: '张晓林', due: '2026-11-12', prio: 'C', done: true },
]

const ALERT_RULES = [
  { key: 'overdue', enabled: true, days: 0, label: '预计完成时间已过期且未关闭' },
  { key: 'highPause', enabled: true, days: null, label: '高优先级（C/H）且状态为未开始 / 暂停' },
  { key: 'custTest', enabled: true, days: 7, label: '已解决但客户测试未完成，且距实际完成超阈值天数' },
]

// ---------- 必填字段（原型 REQUIRED 初始集合） ----------
const REQUIRED_FIELDS = ['project', 'desc', 'priority', 'status']

// =====================================================================
export async function seed() {
  const client = await pool.connect()
  const roleCode = Object.fromEntries(ROLES.map((r) => [r.name, r.code]))
  try {
    await client.query('BEGIN')

    // 角色
    for (const r of ROLES) {
      await client.query(
        `INSERT INTO roles(code, name, "desc", external, color, preset, projects)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,false),ARRAY['ALL']::text[])
         ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, "desc"=EXCLUDED."desc", external=EXCLUDED.external,
           color=EXCLUDED.color, preset=EXCLUDED.preset, projects=EXCLUDED.projects`,
        [r.code, r.name, r.desc, r.external, r.color, r.preset],
      )
    }

    // 权限（20 项）
    for (const p of PERMS) {
      await client.query(
        `INSERT INTO permissions(code, module, name, "desc", allow, no_assign) VALUES ($1,$2,$3,$4,$5,COALESCE($6,false))
         ON CONFLICT (code) DO UPDATE SET module=EXCLUDED.module, name=EXCLUDED.name, "desc"=EXCLUDED."desc",
           allow=EXCLUDED.allow, no_assign=EXCLUDED.no_assign`,
        [p.code, p.module, p.name, p.desc, JSON.stringify(p.allow), p.no_assign],
      )
    }

    // 角色×权限矩阵（按 allow 展开，幂等重建）。
    // 禁止分配的权限不授予非管理员角色；管理员角色始终拥有全部权限，不受影响。
    await client.query('DELETE FROM role_permissions')
    const { rows: noAssignRows } = await client.query('SELECT code FROM permissions WHERE no_assign=true')
    const noAssign = new Set(noAssignRows.map((r) => r.code))
    for (const p of PERMS) {
      for (const roleName of p.allow) {
        if (noAssign.has(p.code) && roleName !== '管理员') continue
        await client.query(
          'INSERT INTO role_permissions(role_code, perm_code) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [roleCode[roleName], p.code],
        )
      }
    }

    // 项目 / 产品 / 人员
    for (const p of PROJECTS) {
      await client.query(
        `INSERT INTO projects(code, name, note, color, preset) VALUES ($1,$2,$3,$4,false)
         ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, note=EXCLUDED.note, color=EXCLUDED.color, preset=EXCLUDED.preset`,
        [p.code, p.name, p.note, p.color],
      )
    }
    for (const p of PRODUCTS) {
      await client.query(
        `INSERT INTO products(code, note, color, preset) VALUES ($1,$2,$3,false)
         ON CONFLICT (code) DO UPDATE SET note=EXCLUDED.note, color=EXCLUDED.color, preset=EXCLUDED.preset`,
        [p.code, p.note, p.color],
      )
    }
    for (const p of PERSONNEL) {
      await client.query(
        `INSERT INTO personnel(code, name, role, "group", color, projects, preset) VALUES ($1,$2,$3,$4,$5,$6,false)
         ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, "group"=EXCLUDED."group",
           color=EXCLUDED.color, projects=EXCLUDED.projects, preset=EXCLUDED.preset`,
        [p.code, p.name, p.role, p.group, p.color, JSON.stringify(p.projects ?? [])],
      )
    }

    // 数据字典（模块项带 product_code，sort 按原型顺序）
    for (const [dictKey, items] of Object.entries(DICTS)) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        await client.query(
          `INSERT INTO dict_items(dict_key, value, label, color, note, product_code, sort, preset)
           VALUES ($1,$2,$3,$4,$5,$6,$7,false)
           ON CONFLICT (dict_key, value) DO UPDATE SET label=EXCLUDED.label, color=EXCLUDED.color,
             note=EXCLUDED.note, product_code=EXCLUDED.product_code, sort=EXCLUDED.sort`,
          [dictKey, it.v, it.v, it.color, it.note ?? null, it.product ?? null, i],
        )
      }
    }

    // 用户（bcrypt 哈希，原型明文仅演示）
    for (const u of USERS) {
      const hash = bcrypt.hashSync(u.password, 10)
      const projects = u.projects === 'ALL' ? ['ALL'] : u.projects.split(',')
      await client.query(
        `INSERT INTO users(username, password_hash, person, personnel_code, role_code, status, projects, preset)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,false))
         ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, person=EXCLUDED.person,
           personnel_code=EXCLUDED.personnel_code, role_code=EXCLUDED.role_code, status=EXCLUDED.status,
           projects=EXCLUDED.projects, preset=EXCLUDED.preset`,
        [u.username, hash, u.person, u.personnelCode ?? null, roleCode[u.role], u.status,
          JSON.stringify(projects), u.preset ?? false],
      )
    }

    // 通知类型 / 待办优先级
    for (const name of NOTICE_TYPES) {
      await client.query(`INSERT INTO notice_types(name, preset) VALUES ($1,false)
        ON CONFLICT (name) DO UPDATE SET preset=EXCLUDED.preset`, [name])
    }
    for (const p of TODO_PRIOS) {
      await client.query(
        `INSERT INTO todo_prios(code, label, preset) VALUES ($1,$2,false)
         ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, preset=EXCLUDED.preset`,
        [p.code, p.label],
      )
    }

    // 通知 / 待办
    for (const n of NOTICES) {
      await client.query(
        `INSERT INTO notices(id, type, title, content, date, pinned, projects, recipients, "groups")
         VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::text[],'{}'::text[])
         ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type, title=EXCLUDED.title, content=EXCLUDED.content,
           date=EXCLUDED.date, pinned=EXCLUDED.pinned, projects=EXCLUDED.projects`,
        [n.id, n.type, n.title, n.content, n.date, n.pinned, n.projects],
      )
    }
    for (const t of TODOS) {
      await client.query(
        `INSERT INTO todos(id, text, owner, due, prio, done) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET text=EXCLUDED.text, owner=EXCLUDED.owner, due=EXCLUDED.due,
           prio=EXCLUDED.prio, done=EXCLUDED.done`,
        [t.id, t.text, t.owner, t.due, t.prio, t.done],
      )
    }

    // 预警规则
    for (const r of ALERT_RULES) {
      await client.query(
        `INSERT INTO alert_rules(key, enabled, days, label, preset, projects)
         VALUES ($1,$2,$3,$4,false,ARRAY['ALL']::text[])
         ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled, days=EXCLUDED.days,
           label=EXCLUDED.label, preset=EXCLUDED.preset, projects=EXCLUDED.projects`,
        [r.key, r.enabled, r.days, r.label],
      )
    }

    // 必填字段
    for (const f of REQUIRED_FIELDS) {
      await client.query('INSERT INTO required_fields(field_key) VALUES ($1) ON CONFLICT DO NOTHING', [f])
    }

    // 种子标记
    await client.query(
      `INSERT INTO app_meta(key, value) VALUES ('seed_version','1')
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    )

    await client.query('COMMIT')
    console.log(`[seed] 完成：5 角色 / ${PERMS.length} 权限 / 9 用户 / 2 项目 / 3 产品 / 8 人员 / 9 类字典 / 3 通知 / 3 待办 / 3 预警规则`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seed().catch((err) => {
    console.error('[seed] 失败:', err.message)
    process.exit(1)
  })
}
