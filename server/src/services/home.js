// 首页工作台服务（见 docs/API契约.md 第 4 节）：KPI / 预警 / 通知 / 待办
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'
import { getTodoRulesMap } from './settings.js'

const csvValues = (v) => (Array.isArray(v) ? v : String(v ?? '').split(','))
  .map((s) => String(s).trim()).filter(Boolean)

// 全项目角色（管理员/项目经理，含显式配置全部项目的情况）看项目内全部人员；
// 其他人员只看与自己相关的记录。
function isPersonScoped(profile, scope) {
  return !!profile?.person && scope !== null && !profile.perms.includes('PROJECT_ALL')
}

// 首页统计的公共过滤：可见项目范围 + 所选项目 + 本人负责/开发/提交的问题
function buildWhere(scope, filters = {}, alias = 'i', profile = null) {
  const clauses = []
  const params = []
  if (scope) {
    params.push(scope)
    clauses.push(`${alias}.project = ANY($${params.length})`)
  }
  const projects = csvValues(filters.project)
  if (projects.length) {
    params.push(projects)
    clauses.push(`${alias}.project = ANY($${params.length})`)
  }
  const personActive = isPersonScoped(profile, scope)
  if (personActive) {
    const idx = params.push(profile.person)
    clauses.push(`(${alias}.owner = $${idx} OR ${alias}.developer = $${idx} OR ${alias}.reporter = $${idx})`)
  }
  return {
    sql: clauses.length ? clauses.join(' AND ') : 'TRUE',
    params, projects, personActive,
  }
}

// ---------- KPI ----------
export async function summary(scope, filters = {}, profile = null) {
  const w = buildWhere(scope, filters, 'i', profile)
  const filtered = w.projects.length > 0 || w.personActive
  const statuses = (await pool.query(
    "SELECT value FROM dict_items WHERE dict_key='status' ORDER BY sort, id")).rows.map((r) => r.value)
  const projQuery = filtered
    ? pool.query(`SELECT count(DISTINCT i.project)::int AS c FROM issues i WHERE ${w.sql}`, w.params)
    : scope
      ? pool.query('SELECT count(*)::int AS c FROM projects WHERE code = ANY($1)', [scope])
      : pool.query('SELECT count(*)::int AS c FROM projects')
  const [proj, total, byStatus, byPriority, overdue] = await Promise.all([
    projQuery,
    pool.query(`SELECT count(*)::int AS c FROM issues i WHERE ${w.sql}`, w.params),
    pool.query(`SELECT status, count(*)::int AS c FROM issues i WHERE ${w.sql} GROUP BY status`, w.params),
    pool.query(`SELECT priority, count(*)::int AS c FROM issues i WHERE ${w.sql} GROUP BY priority`, w.params),
    pool.query(`SELECT count(*)::int AS c FROM issues i
                WHERE ${w.sql} AND i.plan_end < CURRENT_DATE
                  AND i.status NOT IN ('已解决','关闭')`, w.params),
  ])
  const statusMap = Object.fromEntries(byStatus.rows.map((r) => [r.status, r.c]))
  const prioMap = Object.fromEntries(byPriority.rows.map((r) => [r.priority, r.c]))
  return {
    projectCount: proj.rows[0].c,
    issueTotal: total.rows[0].c,
    byStatus: Object.fromEntries(statuses.map((s) => [s, statusMap[s] || 0])),
    byPriority: { C: prioMap.C || 0, H: prioMap.H || 0, M: prioMap.M || 0, L: prioMap.L || 0 },
    overdueCount: overdue.rows[0].c,
  }
}

// Date → 本地 YYYY-MM-DD
const pad = (n) => String(n).padStart(2, '0')
const ymd = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  : String(v).slice(0, 10))

// ---------- 预警（按 alert_rules 启用状态计算） ----------
export async function alerts(scope, filters = {}, profile = null) {
  const rules = (await pool.query('SELECT key, days, enabled FROM alert_rules')).rows
  const on = Object.fromEntries(rules.map((r) => [r.key, r]))
  const out = []
  const w = buildWhere(scope, filters, 'i', profile)

  if (on.overdue?.enabled) {
    const { rows } = await pool.query(
      `SELECT seq, "desc", plan_end FROM issues i
       WHERE ${w.sql} AND i.plan_end < CURRENT_DATE AND i.status NOT IN ('已解决','关闭')
       ORDER BY i.plan_end`, w.params)
    for (const r of rows) {
      out.push({ type: 'overdue', level: 'high',
        text: `问题 #${r.seq} 预计完成 ${ymd(r.plan_end)} 已过期且未关闭`, issueSeq: r.seq })
    }
  }
  if (on.highPause?.enabled) {
    const { rows } = await pool.query(
      `SELECT seq, "desc", priority, status FROM issues i
       WHERE ${w.sql} AND i.priority IN ('C','H') AND i.status IN ('未开始','暂停')
       ORDER BY i.seq`, w.params)
    for (const r of rows) {
      out.push({ type: 'highPause', level: 'mid',
        text: `问题 #${r.seq} ${r.desc}：高优先级（${r.priority}）且状态为「${r.status}」，长期未推进`, issueSeq: r.seq })
    }
  }
  if (on.custTest?.enabled) {
    const days = on.custTest.days || 7
    const params = [...w.params, days]
    const { rows } = await pool.query(
      `SELECT seq, "desc" FROM issues i
       WHERE ${w.sql} AND i.customer_test = '是' AND i.status = '已解决'
         AND i.customer_test_done IS NULL
         AND i.resolved_at <= CURRENT_DATE - $${params.length}::int
       ORDER BY i.resolved_at`, params)
    for (const r of rows) {
      out.push({ type: 'custTest', level: 'low', text: `问题 #${r.seq} ${r.desc}：已解决但客户测试超 ${days} 天未完成`, issueSeq: r.seq })
    }
  }
  return out
}

// ---------- 通知 ----------
const strArray = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()) : [])

// 可见范围：项目权限内 + 接收人/所属组命中；未指定接收人和组时对项目内所有人可见
export async function listNotices(profile, scope) {
  const { rows: people } = await pool.query(
    'SELECT "group" FROM personnel WHERE name = $1 AND enabled = true LIMIT 1', [profile.person])
  const group = people[0]?.group ?? null
  const params = []
  const projectClause = scope
    ? `(cardinality(n.projects) = 0 OR n.projects && $${params.push(scope)}::text[])`
    : 'TRUE'
  let audienceClause = 'TRUE'
  if (!profile.perms.includes('DASH_NOTICE')) {
    const personIdx = params.push(profile.person)
    const groupIdx = params.push(group)
    const userIdx = params.push(profile.username)
    audienceClause = `(
      n.created_by = $${userIdx}
      OR (cardinality(COALESCE(n.recipients, '{}'::text[])) = 0
          AND cardinality(COALESCE(n."groups", '{}'::text[])) = 0)
      OR $${personIdx}::text = ANY(COALESCE(n.recipients, '{}'::text[]))
      OR ($${groupIdx}::text IS NOT NULL AND $${groupIdx}::text = ANY(COALESCE(n."groups", '{}'::text[])))
    )`
  }
  const { rows } = await pool.query(
    `SELECT n.id, n.type, n.title, n.content, n.date, n.pinned, n.created_by, n.created_at,
            n.projects, n.recipients, n."groups"
     FROM notices n
     WHERE ${projectClause} AND ${audienceClause}
     ORDER BY n.pinned DESC, n.date DESC NULLS LAST, n.id`, params)
  return rows
}

// 自增展示 ID（仅统计 prefix + 1~3 位数字，忽略 a<时间戳> 等历史格式）
const nextId = async (table, prefix) => {
  const { rows } = await pool.query(`SELECT id FROM ${table}`)
  let max = 0
  const re = new RegExp(`^${prefix}(\\d{1,3})$`)
  for (const { id } of rows) {
    const m = re.exec(String(id))
    if (m && Number(m[1]) > max) max = Number(m[1])
  }
  return `${prefix}${max + 1}`
}

// 通知类型须为启用的档案项
async function checkNoticeType(type) {
  if (!type) return null
  const { rows } = await pool.query('SELECT name FROM notice_types WHERE name=$1 AND enabled=true', [type])
  if (!rows.length) throw new HttpError(400, ERR.VALIDATION, '通知类型不存在或已停用')
  return type
}

export async function createNotice(body, user) {
  const id = await nextId('notices', 'n')
  const { rows } = await pool.query(
    `INSERT INTO notices(id, type, title, content, date, pinned, created_by, projects, recipients, "groups")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [id, await checkNoticeType(body.type), body.title, body.content || null, body.date || null, !!body.pinned,
      user.username, strArray(body.projects), strArray(body.recipients), strArray(body.groups)])
  return rows[0]
}

export async function updateNotice(id, body) {
  const { rows } = await pool.query(
    `UPDATE notices SET type=$2, title=$3, content=$4, date=$5, pinned=$6,
       projects=$7, recipients=$8, "groups"=$9 WHERE id=$1 RETURNING *`,
    [id, await checkNoticeType(body.type), body.title, body.content ?? null, body.date ?? null, !!body.pinned,
      strArray(body.projects), strArray(body.recipients), strArray(body.groups)])
  if (!rows[0]) throw new HttpError(404, ERR.NOT_FOUND, `通知 ${id} 不存在`)
  return rows[0]
}

export const deleteNotice = (id) =>
  pool.query('DELETE FROM notices WHERE id=$1', [id])

// ---------- 待办 ----------
// 未指定项目视为全员可见；指定项目时与用户可见项目范围求交集
export async function getNoticeProjects(id) {
  const { rows } = await pool.query('SELECT projects FROM notices WHERE id=$1', [id])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '通知不存在')
  return rows[0].projects || []
}
export async function getTodoProjects(id) {
  const { rows } = await pool.query('SELECT projects FROM todos WHERE id=$1', [id])
  if (!rows.length) throw new HttpError(404, ERR.NOT_FOUND, '待办不存在')
  return rows[0].projects || []
}

export async function listTodos(scope, profile = null) {
  const personScoped = isPersonScoped(profile, scope)
  const params = scope ? [scope] : []
  if (personScoped) params.push(profile.person)
  const { rows } = await pool.query(
    `SELECT id, text, projects, owner, start_date, due, completed_at, prio, type, done, created_at FROM todos
     WHERE ${scope ? `(cardinality(projects) = 0 OR projects && $1::text[])` : 'TRUE'}
       ${personScoped ? `AND (owner = $${params.length} OR owner IS NULL)` : ''}
     ORDER BY done, prio, due NULLS LAST, id`, params)
  return rows
}

// 聚合待办：问题（plan_end）+ 项目计划（end_date）+ 手工待办（due/start_date）
// 规则：截止日期不晚于今天起一周（含逾期）、未完成，按待办类型分类。
export async function listAggregatedTodos(scope, filters = {}, profile = null) {
  const owner = filters.owner || null
  const type = filters.type || null
  const project = filters.project || null
  // 项目经理/ALL 角色看项目内全部人员；其他人员只看与自己相关的记录
  const person = isPersonScoped(profile, scope) ? profile.person : null
  const codes = project ? [project]
    : (scope || (await pool.query('SELECT code FROM projects')).rows.map((r) => r.code))
  const rules = await getTodoRulesMap(codes)
  const params = [scope, owner, type, project, person,
    JSON.stringify(rules.days), JSON.stringify(rules.statuses)]
  const { rows } = await pool.query(`
    WITH agg AS (
      SELECT 'issue'::text AS source, '问题'::text AS type, i.id::text AS ref,
             i.seq::text AS ref_no, i."desc"::text AS title, i.owner::text AS owner,
             i.plan_start AS start_date, i.plan_end AS due_date,
             i.status::text AS status, ARRAY[i.project]::text[] AS projects, i.priority AS prio
      FROM issues i
      CROSS JOIN LATERAL (
        SELECT COALESCE(($6::jsonb ->> i.project)::int, ($6::jsonb ->> '*')::int, 7) AS days,
               COALESCE($7::jsonb -> i.project, $7::jsonb -> '*')::jsonb AS statuses
      ) cfg
      WHERE ($1::text[] IS NULL OR i.project = ANY($1::text[]))
        AND ($2::text IS NULL OR i.owner = $2)
        AND ($4::text IS NULL OR i.project = $4)
        AND ($5::text IS NULL OR i.owner = $5 OR i.developer = $5 OR i.reporter = $5)
        AND i.plan_end IS NOT NULL AND i.plan_end <= CURRENT_DATE + cfg.days
        AND i.status = ANY (SELECT jsonb_array_elements_text(cfg.statuses))

      UNION ALL

      SELECT 'plan'::text, '计划'::text, p.id::text, p.seq_no::text, p.title::text, p.owner::text,
             p.start_date, p.end_date, COALESCE(p.status, '未开始')::text,
             ARRAY[p.project]::text[], NULL::varchar
      FROM project_plans p
      CROSS JOIN LATERAL (
        SELECT COALESCE(($6::jsonb ->> p.project)::int, ($6::jsonb ->> '*')::int, 7) AS days,
               COALESCE($7::jsonb -> p.project, $7::jsonb -> '*')::jsonb AS statuses
      ) cfg
      WHERE ($1::text[] IS NULL OR p.project = ANY($1::text[]))
        AND ($2::text IS NULL OR p.owner = $2)
        AND ($4::text IS NULL OR p.project = $4)
        AND ($5::text IS NULL OR p.owner = $5)
        AND p.end_date IS NOT NULL AND p.end_date <= CURRENT_DATE + cfg.days
        AND COALESCE(p.status, '未开始') = ANY (SELECT jsonb_array_elements_text(cfg.statuses))
        AND NOT EXISTS (SELECT 1 FROM project_plans c WHERE c.parent_id = p.id)

      UNION ALL

      SELECT 'todo'::text, t.type::text, t.id::text, t.id::text, t.text::text, t.owner::text,
             t.start_date, COALESCE(t.due, t.start_date),
             (CASE WHEN t.done THEN '关闭' ELSE '未开始' END)::text, t.projects, NULL::varchar
      FROM todos t
      CROSS JOIN LATERAL (
        SELECT COALESCE(($6::jsonb ->> COALESCE(t.projects[1], '*'))::int, ($6::jsonb ->> '*')::int, 7) AS days,
               COALESCE($7::jsonb -> COALESCE(t.projects[1], '*'), $7::jsonb -> '*')::jsonb AS statuses
      ) cfg
      WHERE ($1::text[] IS NULL OR cardinality(t.projects) = 0 OR t.projects && $1::text[])
        AND ($2::text IS NULL OR t.owner = $2)
        AND ($4::text IS NULL OR cardinality(t.projects) = 0 OR $4 = ANY(t.projects))
        AND ($5::text IS NULL OR t.owner = $5 OR t.owner IS NULL)
        AND (
          (
            t.done = false
            AND COALESCE(t.due, t.start_date) IS NOT NULL
            AND COALESCE(t.due, t.start_date) <= CURRENT_DATE + cfg.days
            AND '未开始' = ANY (SELECT jsonb_array_elements_text(cfg.statuses))
          )
          OR (t.done = true AND t.type = '手工')
        )
    )
    SELECT * FROM agg
    WHERE ($3::text IS NULL OR type = $3)
    ORDER BY CASE type WHEN '问题' THEN 1 WHEN '计划' THEN 2 ELSE 3 END,
             due_date NULLS LAST, owner NULLS LAST, ref`, params)
  return rows
}

export async function createTodo(body) {
  const id = await nextId('todos', 't')
  const done = !!body.done
  const { rows } = await pool.query(
    `INSERT INTO todos(id, text, projects, owner, start_date, due, completed_at, prio, type, done)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [id, body.text, strArray(body.projects), body.owner || null, body.start_date || null,
      body.due || null, done ? ymd(new Date()) : null, body.prio || 'M', body.type || '手工', done])
  return rows[0]
}

export async function updateTodo(id, body) {
  const current = await pool.query('SELECT done, completed_at FROM todos WHERE id=$1', [id])
  if (!current.rows[0]) throw new HttpError(404, ERR.NOT_FOUND, `待办 ${id} 不存在`)
  const done = body.done === undefined ? current.rows[0].done : !!body.done
  const completedAt = done
    ? (current.rows[0].completed_at || ymd(new Date()))
    : null
  const { rows } = await pool.query(
    `UPDATE todos SET text=$2, projects=COALESCE($3::text[], projects), owner=$4,
       start_date=$5, due=$6, completed_at=$7, prio=$8, type=$9, done=$10 WHERE id=$1 RETURNING *`,
    [id, body.text, body.projects === undefined ? null : strArray(body.projects),
      body.owner ?? null, body.start_date ?? null, body.due ?? null, completedAt,
      body.prio ?? 'M', body.type || '手工', done])
  if (!rows[0]) throw new HttpError(404, ERR.NOT_FOUND, `待办 ${id} 不存在`)
  return rows[0]
}

export const deleteTodo = (id) => pool.query('DELETE FROM todos WHERE id=$1', [id])
