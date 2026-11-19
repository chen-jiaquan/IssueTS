// 首页工作台服务（见 docs/API契约.md 第 4 节）：KPI / 预警 / 通知 / 待办
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'

const scopeWhere = (scope, alias = 'i') =>
  scope ? { sql: `${alias}.project = ANY($1)`, params: [scope] } : { sql: 'TRUE', params: [] }

// ---------- KPI ----------
export async function summary(scope) {
  const w = scopeWhere(scope)
  const statuses = (await pool.query(
    "SELECT value FROM dict_items WHERE dict_key='status' ORDER BY sort, id")).rows.map((r) => r.value)
  const [proj, total, byStatus, byPriority, overdue] = await Promise.all([
    pool.query(scope
      ? 'SELECT count(*)::int AS c FROM projects WHERE code = ANY($1)'
      : 'SELECT count(*)::int AS c FROM projects', w.params),
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
export async function alerts(scope) {
  const rules = (await pool.query('SELECT key, days, enabled FROM alert_rules')).rows
  const on = Object.fromEntries(rules.map((r) => [r.key, r]))
  const out = []
  const w = scopeWhere(scope)

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
export const listNotices = () =>
  pool.query('SELECT id, type, title, content, date, pinned, created_by, created_at FROM notices ORDER BY pinned DESC, date DESC NULLS LAST, id').then((r) => r.rows)

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

export async function createNotice(body, user) {
  const id = await nextId('notices', 'n')
  const { rows } = await pool.query(
    `INSERT INTO notices(id, type, title, content, date, pinned, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, body.type || null, body.title, body.content || null, body.date || null, !!body.pinned, user.username])
  return rows[0]
}

export async function updateNotice(id, body) {
  const { rows } = await pool.query(
    `UPDATE notices SET type=$2, title=$3, content=$4, date=$5, pinned=$6 WHERE id=$1 RETURNING *`,
    [id, body.type ?? null, body.title, body.content ?? null, body.date ?? null, !!body.pinned])
  if (!rows[0]) throw new HttpError(404, ERR.NOT_FOUND, `通知 ${id} 不存在`)
  return rows[0]
}

export const deleteNotice = (id) =>
  pool.query('DELETE FROM notices WHERE id=$1', [id])

// ---------- 待办 ----------
export const listTodos = () =>
  pool.query('SELECT id, text, owner, due, prio, done, created_at FROM todos ORDER BY done, prio, due NULLS LAST, id').then((r) => r.rows)

export async function createTodo(body) {
  const id = await nextId('todos', 't')
  const { rows } = await pool.query(
    'INSERT INTO todos(id, text, owner, due, prio, done) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [id, body.text, body.owner || null, body.due || null, body.prio || 'M', !!body.done])
  return rows[0]
}

export async function updateTodo(id, body) {
  const { rows } = await pool.query(
    'UPDATE todos SET text=$2, owner=$3, due=$4, prio=$5, done=$6 WHERE id=$1 RETURNING *',
    [id, body.text, body.owner ?? null, body.due ?? null, body.prio ?? 'M', !!body.done])
  if (!rows[0]) throw new HttpError(404, ERR.NOT_FOUND, `待办 ${id} 不存在`)
  return rows[0]
}

export const deleteTodo = (id) => pool.query('DELETE FROM todos WHERE id=$1', [id])
