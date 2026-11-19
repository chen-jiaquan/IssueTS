// 问题服务：列表/详情/增删改/批量/分配/留痕/日志/导入导出
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'
import { ISSUE_FIELDS } from '../schemas/issues.js'
import { invalidatePivotCache } from './stats.js'

// 字段中文名（issue_logs.field_label / 导出表头），与原型 COLS 对应
export const FIELD_LABELS = {
  project: '项目', stage: '阶段', type: '类型', module: '模块', desc: '需求描述',
  priority: '优先级', impact: '影响程度', reporter: '提出人', reported_at: '提出日期',
  owner: '负责人', plan_start: '预计开始', plan_end: '预计完成',
  developer: '开发人员', solution: '开发方案', track: '跟踪记录',
  pending_test: '待测试', status: '状态', resolved_at: '实际完成',
  customer_test: '客户测试', customer_test_done: '客户测试完成',
  image_url: '图片', custom_fields: '自定义字段',
}

// 统一值规范化：Date→本地 YYYY-MM-DD（避免 UTC 偏移一天），对象/数组→JSON，空→''
const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const norm = (v) => {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return localDate(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const toIn = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// ---------- 单据写入时校验档案是否启用（历史值保持不变则允许） ----------
const PERSON_ARCHIVE_KEYS = ['reporter', 'owner', 'developer']
const DICT_ARCHIVE_KEYS = ['stage', 'type', 'module', 'priority', 'impact', 'status', 'pending_test', 'customer_test']

async function assertArchiveEnabled(sql, params, label) {
  const { rows } = await pool.query(`SELECT enabled FROM ${sql} WHERE ${params.where}`, params.values)
  if (rows.length && rows[0].enabled === false) {
    throw new HttpError(400, ERR.VALIDATION, `${label}档案已禁用，不能选择`, [{ field: params.field }])
  }
}

export async function assertIssueArchivesEnabled(body, old = null) {
  for (const key of PERSON_ARCHIVE_KEYS) {
    const value = body[key]
    if (!value || (old && norm(old[key]) === norm(value))) continue
    await assertArchiveEnabled('personnel', {
      where: 'name=$1', values: [value], field: key,
    }, FIELD_LABELS[key])
  }
  if (body.project && (!old || norm(old.project) !== norm(body.project))) {
    await assertArchiveEnabled('projects', { where: 'code=$1', values: [body.project], field: 'project' }, FIELD_LABELS.project)
  }
  const project = body.project ?? old?.project
  for (const key of DICT_ARCHIVE_KEYS) {
    const value = body[key]
    if (!value || (old && norm(old[key]) === norm(value))) continue
    const { rows } = await pool.query(
      'SELECT enabled, project_code FROM dict_items WHERE dict_key=$1 AND value=$2', [key, value])
    if (rows.length && rows[0].enabled === false) {
      throw new HttpError(400, ERR.VALIDATION, `${FIELD_LABELS[key]}档案已禁用，不能选择`, [{ field: key }])
    }
    if (rows.length && rows[0].project_code && project && rows[0].project_code !== project) {
      throw new HttpError(400, ERR.VALIDATION,
        `${FIELD_LABELS[key]}「${value}」仅适用于项目 ${rows[0].project_code}，不能用于 ${project}`, [{ field: key }])
    }
  }
}

// 表头筛选：空值选项的特殊标记（前后端约定；前端显示为「空值」）
export const EMPTY_MARK = '__EMPTY__'
// 多值筛选条件：支持空值标记 → col IS NULL / col = ''
function addMultiFilter(where, params, base, raw, date = false) {
  const parts = toIn(raw)
  const wantEmpty = parts.includes(EMPTY_MARK)
  const vals = parts.filter((v) => v !== EMPTY_MARK)
  const ors = []
  if (vals.length) {
    params.push(vals)
    ors.push(`${date ? `${base}::text` : base} = ANY($${params.length})`)
  }
  if (wantEmpty) ors.push(date ? `${base} IS NULL` : `(${base} IS NULL OR ${base} = '')`)
  if (ors.length) where.push(`(${ors.join(' OR ')})`)
}

// ---------- 列表/导出共用的筛选条件（表头多选筛选 + scope） ----------
function buildIssueWhere(query, scope) {
  const whereClauses = []
  const params = []
  const add = (sql, ...vals) => { params.push(...vals); whereClauses.push(sql.replace('?', `$${params.length}`)) }

  if (scope) {
    params.push(scope)
    whereClauses.push(`project = ANY($${params.length})`)
  }
  // 文本/枚举列（表头多选筛选，含空值选项）
  for (const key of ['project', 'stage', 'type', 'module', 'priority', 'impact', 'status', 'pending_test', 'customer_test', 'reporter', 'owner', 'developer']) {
    if (query[key] !== undefined && query[key] !== '') addMultiFilter(whereClauses, params, key, query[key])
  }
  // 日期列：pg DATE 与文本数组比较需转 text（与前端 YYYY-MM-DD 值一致）
  for (const key of ['reported_at', 'plan_start', 'plan_end', 'resolved_at', 'customer_test_done']) {
    if (query[key] !== undefined && query[key] !== '') addMultiFilter(whereClauses, params, key, query[key], true)
  }
  // 统计报表期间过滤：按所选时间字段映射列，起止闭区间（倒置时自动交换）
  const rangeCol = { planEnd: 'plan_end', resolvedAt: 'resolved_at' }[query.timeField]
  if (rangeCol && (query.dateFrom || query.dateTo)) {
    let from = query.dateFrom
    let to = query.dateTo
    if (from && to && from > to) [from, to] = [to, from]
    if (from) {
      params.push(from)
      whereClauses.push(`${rangeCol} >= $${params.length}::date`)
    }
    if (to) {
      params.push(to)
      whereClauses.push(`${rangeCol} <= $${params.length}::date`)
    }
  }
  // 序号 / 描述列：精确多选（描述列来自当前页取值，含空值选项）
  for (const key of ['seq', 'desc']) {
    if (query[key] !== undefined && query[key] !== '') addMultiFilter(whereClauses, params, key === 'seq' ? 'seq' : '"desc"', query[key], key === 'seq')
  }
  if (query.q) {
    params.push(`%${query.q}%`)
    whereClauses.push(`("desc" ILIKE $${params.length} OR solution ILIKE $${params.length})`)
  }
  // 工作台「逾期未关闭」下钻
  if (query.overdue === '1' || query.overdue === 'true') {
    whereClauses.push("plan_end < CURRENT_DATE AND status NOT IN ('已解决','关闭')")
  }

  return {
    whereClauses,
    whereSql: whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '',
    params,
    sortCol: query.sort || 'seq',
    sortDir: query.order === 'desc' ? 'DESC' : 'ASC',
  }
}

// ---------- 列表（表头多选筛选 + 分页 + 排序 + scope） ----------
export async function listIssues(query, scope) {
  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 50
  const { whereSql, params, sortCol, sortDir } = buildIssueWhere(query, scope)

  const countSql = `SELECT count(*)::int AS total FROM issues ${whereSql}`
  const listSql = `
    SELECT i.*, (SELECT count(*)::int FROM issue_logs l WHERE l.issue_id = i.id) AS logs_count
    FROM issues i ${whereSql}
    ORDER BY ${sortCol} ${sortDir} NULLS LAST, seq ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
  const [{ rows: [c] }, { rows }] = await Promise.all([pool.query(countSql, params), pool.query(listSql, params)])
  return { list: rows, total: c.total, page, pageSize }
}

// ---------- 导出：按 seq 游标分批读取匹配记录（limit=0 表示不限制） ----------
export async function* iterateIssuesForExport(query, scope, { batchSize = 1000, limit = 0 } = {}) {
  const { whereClauses, params } = buildIssueWhere(query, scope)
  let lastSeq = 0
  let emitted = 0
  for (;;) {
    const take = limit > 0 ? Math.min(batchSize, limit - emitted) : batchSize
    if (take <= 0) return
    const batchParams = [...params]
    const clauses = [...whereClauses]
    if (lastSeq) {
      batchParams.push(lastSeq)
      clauses.push(`seq > $${batchParams.length}`)
    }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const sql = `SELECT i.* FROM issues i ${whereSql} ORDER BY seq ASC LIMIT $${batchParams.length + 1}`
    const { rows } = await pool.query(sql, [...batchParams, take])
    if (!rows.length) return
    for (const row of rows) {
      yield row
      emitted += 1
      if (limit > 0 && emitted >= limit) return
    }
    if (rows.length < take) return
    lastSeq = rows[rows.length - 1].seq
  }
}

// ---------- 表头筛选候选值（全量数据去重，跨页可选，含 scope） ----------
const FILTER_OPT_TEXT_KEYS = ['stage', 'type', 'module', 'priority', 'impact', 'status', 'pending_test', 'customer_test', 'reporter', 'owner', 'developer']
const FILTER_OPT_DATE_KEYS = ['reported_at', 'plan_start', 'plan_end', 'resolved_at', 'customer_test_done']
export async function filterOptions(scope) {
  const textKeys = FILTER_OPT_TEXT_KEYS
  const dateKeys = FILTER_OPT_DATE_KEYS
  const defs = [
    ...textKeys.flatMap((k) => [
      [`array_agg(DISTINCT ${k}) FILTER (WHERE ${k} IS NOT NULL AND ${k} <> '')`, k],
      [`count(*) FILTER (WHERE ${k} IS NULL OR ${k} = '') > 0`, `${k}__empty`],
    ]),
    ...dateKeys.flatMap((k) => [
      [`array_agg(DISTINCT ${k}::text) FILTER (WHERE ${k} IS NOT NULL)`, k],
      [`count(*) FILTER (WHERE ${k} IS NULL) > 0`, `${k}__empty`],
    ]),
  ]
  const params = []
  let scopeSql = ''
  if (scope) {
    params.push(scope)
    scopeSql = 'WHERE project = ANY($1)'
  }
  const selectSql = defs.map(([expr, alias]) => `${expr} AS "${alias}"`).join(', ')
  const { rows: [row] } = await pool.query(`SELECT ${selectSql} FROM issues ${scopeSql}`, params)
  const out = {}
  for (const k of [...textKeys, ...dateKeys]) {
    out[k] = row?.[k] || []
    if (row?.[`${k}__empty`]) out[k].push(EMPTY_MARK)
  }
  return out
}

// ---------- 详情（含 track 与日志聚合） ----------
export async function getIssueBySeq(seq, scope) {
  const { rows } = await pool.query(`
    SELECT i.*, (SELECT json_agg(l ORDER BY l.changed_at DESC) FROM issue_logs l WHERE l.issue_id = i.id) AS logs
    FROM issues i WHERE i.seq = $1`, [seq])
  const issue = rows[0]
  if (!issue) throw new HttpError(404, ERR.NOT_FOUND, `问题 #${seq} 不存在`)
  if (scope && !scope.includes(issue.project)) throw new HttpError(403, ERR.SCOPE, `无权访问项目：${issue.project}`)
  return issue
}

// ---------- 新增（留痕 __create__） ----------
export async function createIssue(body, user) {
  await assertIssueArchivesEnabled(body)
  const seqRow = await pool.query('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM issues')
  const seq = seqRow.rows[0].next
  const cols = ISSUE_FIELDS.filter((k) => body[k] !== undefined)
  const vals = cols.map((k) => (['track', 'custom_fields'].includes(k) ? JSON.stringify(body[k] ?? null) : body[k]))
  const { rows } = await pool.query(
    `INSERT INTO issues(seq, ${cols.map((c) => c === 'desc' ? '"desc"' : c).join(', ')}, created_by)
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, $${cols.length + 2})
     RETURNING *`,
    [seq, ...vals, user.username])
  const issue = rows[0]
  await pool.query(
    'INSERT INTO issue_logs(issue_id, issue_seq, changed_by, field_key, field_label, before_value, after_value) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [issue.id, seq, user.username, '__create__', '创建', '', String(seq)])
  invalidatePivotCache()
  return issue
}

// ---------- 编辑（字段级留痕） ----------
export async function updateIssue(seq, body, user, scope) {
  const old = await getIssueBySeq(seq, scope)
  await assertIssueArchivesEnabled(body, old)
  const changed = ISSUE_FIELDS.filter((k) => body[k] !== undefined && norm(old[k]) !== norm(body[k]))
  if (!changed.length) return { issue: old, changed: [] }

  const sets = changed.map((k, i) => `${k === 'desc' ? '"desc"' : k} = $${i + 2}`)
  const vals = changed.map((k) => (['track', 'custom_fields'].includes(k) ? JSON.stringify(body[k]) : body[k]))
  const { rows } = await pool.query(
    `UPDATE issues SET ${sets.join(', ')}, updated_at = now() WHERE seq = $1 RETURNING *`,
    [seq, ...vals])
  const issue = rows[0]

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const k of changed) {
      await client.query(
        'INSERT INTO issue_logs(issue_id, issue_seq, changed_by, field_key, field_label, before_value, after_value) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [issue.id, seq, user.username, k, FIELD_LABELS[k] ?? k, norm(old[k]), norm(body[k])])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  invalidatePivotCache()
  return { issue, changed }
}

// ---------- 删除 ----------
export async function deleteIssue(seq, scope) {
  const issue = await getIssueBySeq(seq, scope)
  await pool.query('DELETE FROM issues WHERE id = $1', [issue.id]) // logs 级联删除
  invalidatePivotCache()
}

// ---------- 批量删除（逐行做 scope 校验，日志随行级联清理） ----------
export async function batchDelete(seqs, scope) {
  const results = []
  for (const seq of seqs) {
    try {
      await deleteIssue(seq, scope)
      results.push({ seq, ok: true })
    } catch (e) {
      results.push({ seq, ok: false, message: e.message })
    }
  }
  return results
}

// ---------- 批量修改（逐行留痕） ----------
export async function batchUpdate(seqs, patch, user, scope) {
  const results = []
  for (const seq of seqs) {
    try {
      const r = await updateIssue(seq, patch, user, scope)
      results.push({ seq, ok: true, changed: r.changed.map((k) => FIELD_LABELS[k] ?? k) })
    } catch (e) {
      results.push({ seq, ok: false, message: e.message })
    }
  }
  return results
}

// ---------- 行内分配（+ 自动生成通知） ----------
export async function assign(seq, field, value, user, scope) {
  const issue = await getIssueBySeq(seq, scope)
  if (norm(issue[field]) === norm(value)) return { issue, notice: null }
  await assertIssueArchivesEnabled({ [field]: value }, issue)
  const { rows } = await pool.query(
    `UPDATE issues SET ${field} = $2, updated_at = now() WHERE id = $1 RETURNING *`, [issue.id, value])
  await pool.query(
    'INSERT INTO issue_logs(issue_id, issue_seq, changed_by, field_key, field_label, before_value, after_value) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [issue.id, seq, user.username, field, FIELD_LABELS[field], norm(issue[field]), value])
  // 通知：类型取启用的 notice_types 首项，项目与接收人取自当前问题
  const nt = await pool.query('SELECT name FROM notice_types WHERE enabled=true ORDER BY id LIMIT 1')
  const nRow = await pool.query(
    `INSERT INTO notices(id, type, title, content, date, pinned, created_by, projects, recipients, "groups")
     VALUES ($1,$2,$3,$4,CURRENT_DATE,false,$5,ARRAY[$6]::text[],ARRAY[$7]::text[],'{}'::text[]) RETURNING id`,
    [`a${Date.now()}`, nt.rows[0]?.name ?? '通知',
     `问题 #${seq} 分配了${FIELD_LABELS[field]}给你`,
     `「${String(issue.desc).slice(0, 30)}」已分配：${value}（由 ${user.username} 操作）`,
     user.username, issue.project, value])
  return { issue: rows[0], notice: nRow.rows[0] }
}

// ---------- 单问题日志 ----------
export const logsOfIssue = (seq) =>
  pool.query(
    'SELECT id, changed_at, changed_by, field_key, field_label, before_value, after_value FROM issue_logs WHERE issue_seq=$1 ORDER BY changed_at DESC',
    [seq]).then((r) => r.rows)

// ---------- 全局日志查询（筛选+分页） ----------
export async function queryLogs(query, scope) {
  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 50
  const where = []
  const params = []
  if (scope) { params.push(scope); where.push(`i.project = ANY($${params.length}::text[])`) }
  const add = (sql, ...vals) => { params.push(...vals); where.push(sql.replace('?', `$${params.length}`)) }
  if (query.by) add('l.changed_by = ?', query.by)
  if (query.field) add('l.field_key = ?', query.field)
  if (query.issue_seq) add('l.issue_seq = ?', query.issue_seq)
  if (query.from) add('l.changed_at >= ?', `${query.from} 00:00:00`)
  if (query.to) add('l.changed_at <= ?', `${query.to} 23:59:59`)
  if (query.q) {
    params.push(`%${query.q}%`)
    where.push(`(l.after_value ILIKE $${params.length} OR l.before_value ILIKE $${params.length} OR i."desc" ILIKE $${params.length})`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const base = `FROM issue_logs l JOIN issues i ON i.id = l.issue_id ${whereSql}`
  const [{ rows: [c] }, { rows }] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total ${base}`, params),
    pool.query(`SELECT l.changed_at, l.issue_seq, i."desc" AS issue_desc, l.changed_by,
                l.field_key, l.field_label, l.before_value, l.after_value ${base}
                ORDER BY l.changed_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
  ])
  return { list: rows, total: c.total, page, pageSize }
}
