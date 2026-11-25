// 项目计划：编写/导入/层级汇总（父级时间与工时由下级自动汇总）
import ExcelJS from 'exceljs'
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'
import { getCalendarMap, calcPlanMetrics } from './workCalendar.js'
import { readHeaders, buildFailFile, structuralFail, cellValue } from './excel.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const dateStr = (v) => {
  if (!v) return null
  if (typeof v === 'string') return v.slice(0, 10)
  const pad = (n) => String(n).padStart(2, '0')
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
}
const out = (r) => ({
  ...r,
  start_date: dateStr(r.start_date),
  end_date: dateStr(r.end_date),
  actual_start_date: dateStr(r.actual_start_date),
  actual_end_date: dateStr(r.actual_end_date),
  completion_rate: Number(r.completion_rate || 0),
  hours: Number(r.hours || 0),
  man_days: Number(r.man_days || 0),
  has_children: !!r.has_children,
  track: Array.isArray(r.track) ? r.track : [],
  logs_count: Number(r.logs_count || 0),
})

const PLAN_FIELD_LABELS = {
  project: '项目', parent_id: '上级任务', seq_no: '序号', title: '任务名称', category: '分类',
  owner: '负责人', assistant1: '配合人1', assistant2: '配合人2',
  start_date: '开始时间', end_date: '完成时间',
  actual_start_date: '实际开始', actual_end_date: '实际完成', completion_rate: '完成比例',
  hours: '工时', man_days: '人天',
  sort: '排序', status: '状态', note: '备注', predecessor: '前置任务', track: '跟踪记录',
  __create__: '创建计划',
}
const norm = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
const trackOf = (v) => (Array.isArray(v) ? v : [])
async function writePlanLogs(client, id, user, changes) {
  const by = user?.username || ''
  for (const [key, before, after] of changes) {
    const b = norm(before)
    const a = norm(after)
    if (b === a) continue
    await client.query(
      `INSERT INTO project_plan_logs(plan_id, changed_by, field_key, field_label, before_value, after_value)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, by, key, PLAN_FIELD_LABELS[key] || key, b, a])
  }
}

// 实际开始/实际完成首次填写时自动推进状态；已有实际日期时不覆盖用户手动选择
const statusWithActual = (status, actualStart, actualEnd, prevStart, prevEnd) => {
  if (actualEnd && !prevEnd) return '已解决'
  if (actualStart && !prevStart) return '进行中'
  return status || '未开始'
}
const predecessorStr = (v) => (Array.isArray(v) ? v.join(',') : (v ? String(v) : null))
const mapPredecessor = (v, idMap) => {
  if (!v) return null
  const ids = Array.isArray(v) ? v : String(v).split(',')
  return ids.map((s) => {
    const key = String(s).trim()
    return idMap.get(key) || key
  }).filter(Boolean).join(',') || null
}
function planMetrics(start, end, calendarMap, hours, manDays) {
  const metrics = calcPlanMetrics(start, end, calendarMap)
  const hasRange = !!(start && end)
  return {
    hours: hasRange ? metrics.hours : Number(hours || 0),
    man_days: hasRange ? metrics.man_days : Number(manDays || 0),
  }
}

async function nextId(client) {
  const { rows } = await client.query('SELECT id FROM project_plans')
  let max = 0
  for (const r of rows) {
    const m = /^p(\d{1,5})$/.exec(r.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

async function getRow(client, id) {
  const { rows } = await client.query(
    `SELECT p.*, EXISTS(SELECT 1 FROM project_plans c WHERE c.parent_id=p.id) AS has_children,
       (SELECT count(*) FROM project_plan_logs l WHERE l.plan_id=p.id) AS logs_count
     FROM project_plans p WHERE p.id=$1`, [id])
  if (!rows[0]) throw new HttpError(404, ERR.NOT_FOUND, `项目计划 ${id} 不存在`)
  return out(rows[0])
}

async function assertVisible(scope, project) {
  if (scope && !scope.includes(project)) throw new HttpError(403, ERR.SCOPE, `无权访问项目：${project}`)
}

// 校验父级存在、同项目、且不构成环
async function assertParent(client, parentId, project, excludeId = null) {
  if (!parentId) return null
  const { rows } = await client.query('SELECT id, project, parent_id FROM project_plans WHERE id=$1', [parentId])
  if (!rows[0]) throw new HttpError(400, ERR.VALIDATION, `上级计划 ${parentId} 不存在`)
  if (rows[0].project !== project) throw new HttpError(400, ERR.VALIDATION, '上级计划必须与原计划属于同一项目')
  const visited = new Set([excludeId].filter(Boolean))
  let cur = rows[0]
  while (cur) {
    if (visited.has(cur.id)) throw new HttpError(400, ERR.VALIDATION, '上级计划不能选择自己或下级计划')
    visited.add(cur.id)
    if (cur.id === excludeId) throw new HttpError(400, ERR.VALIDATION, '上级计划不能选择自己或下级计划')
    if (!cur.parent_id) break
    const r = await client.query('SELECT id, project, parent_id FROM project_plans WHERE id=$1', [cur.parent_id])
    cur = r.rows[0] || null
  }
  return parentId
}

// 从当前节点向上逐级重算：有下级时以 min(开始) / max(结束) / sum(工时、人天) 覆盖，
// 实际开始/实际完成同样取下级最早/最晚
async function rollup(client, id) {
  const seen = new Set()
  while (id && !seen.has(id)) {
    seen.add(id)
    const { rows } = await client.query(
      `SELECT count(*)::int c, min(start_date) s, max(end_date) e,
         min(actual_start_date) as_, max(actual_end_date) ae,
         COALESCE(sum(hours),0) h, COALESCE(sum(man_days),0) md
       FROM project_plans WHERE parent_id=$1`, [id])
    if (rows[0].c > 0) {
      await client.query(
        `UPDATE project_plans SET start_date=$2, end_date=$3, actual_start_date=$4, actual_end_date=$5,
           hours=$6, man_days=$7, updated_at=now() WHERE id=$1`,
        [id, rows[0].s, rows[0].e, rows[0].as_, rows[0].ae, rows[0].h, rows[0].md])
    }
    const p = await client.query('SELECT parent_id FROM project_plans WHERE id=$1', [id])
    id = p.rows[0]?.parent_id || null
  }
}

async function descendants(client, id) {
  const ids = []
  const queue = [id]
  const seen = new Set()
  while (queue.length) {
    const cur = queue.pop()
    if (seen.has(cur)) continue
    seen.add(cur)
    ids.push(cur)
    const { rows } = await client.query('SELECT id FROM project_plans WHERE parent_id=$1', [cur])
    queue.push(...rows.map((r) => r.id))
  }
  return ids
}

export async function listPlans(scope, project) {
  const { rows } = await pool.query(
    `SELECT p.*, EXISTS(SELECT 1 FROM project_plans c WHERE c.parent_id=p.id) AS has_children,
       (SELECT count(*) FROM project_plan_logs l WHERE l.plan_id=p.id) AS logs_count
     FROM project_plans p
     WHERE ($1::text[] IS NULL OR p.project = ANY($1::text[]))
       AND ($2::text IS NULL OR p.project = $2)
     ORDER BY p.project, p.sort, p.created_at, p.id`, [scope || null, project || null])
  return rows.map(out)
}

export async function logsOfPlan(id, scope) {
  const client = await pool.connect()
  try {
    const plan = await getRow(client, id)
    await assertVisible(scope, plan.project)
    const { rows } = await client.query(
      'SELECT * FROM project_plan_logs WHERE plan_id=$1 ORDER BY changed_at DESC, id DESC', [id])
    return rows
  } finally {
    client.release()
  }
}

export async function createPlan(body, user, scope) {
  await assertVisible(scope, body.project)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const calendarMap = await getCalendarMap()
    const metrics = planMetrics(body.start_date, body.end_date, calendarMap, body.hours, body.man_days)
    const id = `p${await nextId(client)}`
    const parentId = await assertParent(client, body.parent_id || null, body.project)
    const actualStart = dateStr(body.actual_start_date)
    const actualEnd = dateStr(body.actual_end_date)
    const status = statusWithActual(body.status, actualStart, actualEnd)
    await client.query(
      `INSERT INTO project_plans(id, project, seq_no, parent_id, title, owner, assistant1, assistant2, status,
         start_date, end_date, actual_start_date, actual_end_date, completion_rate,
         hours, man_days, sort, note, category, predecessor, track, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [id, body.project, body.seq_no || null, parentId, body.title, body.owner || null,
        body.assistant1 || null, body.assistant2 || null, status,
        body.start_date || null, body.end_date || null,
        actualStart, actualEnd, Number(body.completion_rate || 0),
        metrics.hours, metrics.man_days, Number(body.sort || 0), body.note || null,
        body.category || null, predecessorStr(body.predecessor),
        JSON.stringify(trackOf(body.track)), user.username])
    await writePlanLogs(client, id, user, [['__create__', '', '创建计划']])
    await rollup(client, parentId)
    await client.query('COMMIT')
    return getRow(client, id)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

async function updateFieldsInTx(client, id, current, body, calendarMap, user, idMap = new Map()) {
  const project = body.project || current.project
  if (project !== current.project && (current.parent_id || current.has_children)) {
    throw new HttpError(400, ERR.VALIDATION, '有上下级关系的计划不能修改项目')
  }
  const start = body.start_date ?? current.start_date
  const end = body.end_date ?? current.end_date
  const metrics = planMetrics(start, end, calendarMap, body.hours ?? current.hours, body.man_days ?? current.man_days ?? 0)
  const assistant1 = body.assistant1 === undefined ? (current.assistant1 || '') : (body.assistant1 || '')
  const assistant2 = body.assistant2 === undefined ? (current.assistant2 || '') : (body.assistant2 || '')
  // 有下级的汇总任务不允许直接填写实际日期，由下级汇总产生
  const isParent = !!current.has_children
  const actualStart = isParent || body.actual_start_date === undefined
    ? dateStr(current.actual_start_date) : dateStr(body.actual_start_date)
  const actualEnd = isParent || body.actual_end_date === undefined
    ? dateStr(current.actual_end_date) : dateStr(body.actual_end_date)
  const status = statusWithActual(
    body.status === undefined ? current.status : body.status,
    actualStart, actualEnd, dateStr(current.actual_start_date), dateStr(current.actual_end_date))
  const category = body.category === undefined ? (current.category ?? null) : (body.category || null)
  const predecessor = body.predecessor === undefined
    ? (current.predecessor ?? null) : mapPredecessor(body.predecessor, idMap)
  const track = body.track === undefined ? trackOf(current.track) : trackOf(body.track)
  const seqNo = body.seq_no === undefined ? (current.seq_no || null) : (body.seq_no || null)
  const completionRate = Number(body.completion_rate ?? current.completion_rate ?? 0)
  const next = {
    project, seq_no: seqNo, title: body.title ?? current.title, owner: body.owner ?? current.owner,
    assistant1, assistant2, start_date: start, end_date: end,
    actual_start_date: actualStart, actual_end_date: actualEnd, completion_rate: completionRate,
    hours: metrics.hours, man_days: metrics.man_days,
    sort: Number(body.sort ?? current.sort), status, note: body.note ?? current.note,
    category, predecessor, track,
  }
  await client.query(
    `UPDATE project_plans SET project=$2, seq_no=$3, title=$4, owner=$5, assistant1=$6, assistant2=$7, status=$8,
       start_date=$9, end_date=$10, actual_start_date=$11, actual_end_date=$12, completion_rate=$13,
       hours=$14, man_days=$15, sort=$16, note=$17,
       category=$18, predecessor=$19, track=$20, updated_at=now()
     WHERE id=$1`,
    [id, next.project, seqNo, next.title, next.owner, assistant1 || null, assistant2 || null, status,
      next.start_date, next.end_date, actualStart, actualEnd, completionRate,
      next.hours, next.man_days, next.sort, next.note ?? null,
      category, predecessor, JSON.stringify(track)])
  const changes = []
  for (const key of Object.keys(PLAN_FIELD_LABELS)) {
    if (key === '__create__' || key === 'parent_id') continue
    changes.push([key, current[key], next[key]])
  }
  await writePlanLogs(client, id, user, changes)
}

export async function updatePlan(id, body, scope, user) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await getRow(client, id)
    const project = body.project || current.project
    await assertVisible(scope, project)
    const parentId = await assertParent(client,
      body.parent_id === undefined ? current.parent_id : (body.parent_id || null), project, id)
    const calendarMap = await getCalendarMap()
    await updateFieldsInTx(client, id, current, body, calendarMap, user)
    await client.query('UPDATE project_plans SET parent_id=$2 WHERE id=$1', [id, parentId])
    if (current.parent_id !== parentId) {
      await writePlanLogs(client, id, user, [['parent_id', current.parent_id, parentId]])
    }
    await rollup(client, id)
    if (current.parent_id && current.parent_id !== parentId) await rollup(client, current.parent_id)
    await client.query('COMMIT')
    return getRow(client, id)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// 批量保存：新增行可携带 tmp-* 临时 ID，供同一批次内的 parent_id / predecessor 互相引用
export async function batchSavePlans(rows, user, scope) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const calendarMap = await getCalendarMap()
    let seq = await nextId(client)
    const assigned = rows.map((row) => {
      const isNew = !row.id || String(row.id).startsWith('tmp-')
      return { row, id: isNew ? `p${seq++}` : String(row.id), isNew }
    })
    const tempMap = new Map(assigned.filter((a) => a.isNew && a.row.id)
      .map((a) => [String(a.row.id), a.id]))

    for (const a of assigned.filter((x) => x.isNew)) {
      const b = a.row
      await assertVisible(scope, b.project)
      const metrics = planMetrics(b.start_date, b.end_date, calendarMap, b.hours, b.man_days)
      const actualStart = dateStr(b.actual_start_date)
      const actualEnd = dateStr(b.actual_end_date)
      const status = statusWithActual(b.status, actualStart, actualEnd)
      await client.query(
        `INSERT INTO project_plans(id, project, seq_no, title, owner, assistant1, assistant2, status,
           start_date, end_date, actual_start_date, actual_end_date, completion_rate,
           hours, man_days, sort, note, category, predecessor, track, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [a.id, b.project, b.seq_no || null, b.title, b.owner || null, b.assistant1 || null, b.assistant2 || null,
          status, b.start_date || null, b.end_date || null,
          actualStart, actualEnd, Number(b.completion_rate || 0),
          metrics.hours, metrics.man_days,
          Number(b.sort || 0), b.note || null, b.category || null,
          mapPredecessor(b.predecessor, tempMap), JSON.stringify(trackOf(b.track)), user.username])
      await writePlanLogs(client, a.id, user, [['__create__', '', '创建计划']])
    }

    const parents = new Set()
    for (const a of assigned) {
      const b = a.row
      await assertVisible(scope, b.project)
      const current = a.isNew ? null : await getRow(client, a.id)
      const project = b.project || current?.project
      const rawParent = b.parent_id === undefined ? (current?.parent_id || null) : b.parent_id
      const parentId = await assertParent(client,
        rawParent ? (tempMap.get(String(rawParent)) || String(rawParent)) : null, project, a.id)
      if (a.isNew) {
        if (parentId) await client.query('UPDATE project_plans SET parent_id=$2 WHERE id=$1', [a.id, parentId])
      } else {
        await updateFieldsInTx(client, a.id, current, b, calendarMap, user, tempMap)
        if (current.parent_id !== parentId) {
          await client.query('UPDATE project_plans SET parent_id=$2 WHERE id=$1', [a.id, parentId])
          await writePlanLogs(client, a.id, user, [['parent_id', current.parent_id, parentId]])
        }
        if (current.parent_id) parents.add(current.parent_id)
      }
      if (parentId) parents.add(parentId)
    }
    for (const parentId of parents) await rollup(client, parentId)
    await client.query('COMMIT')
    return assigned.map((a) => a.id)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function deletePlan(id, scope) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await getRow(client, id)
    await assertVisible(scope, current.project)
    const ids = await descendants(client, id)
    await client.query('DELETE FROM project_plans WHERE id = ANY($1::text[])', [ids])
    await rollup(client, current.parent_id)
    await client.query('COMMIT')
    return { deleted: ids.length }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

function parseDate(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10)
  const s = String(v).trim()
  return DATE_RE.test(s) ? s.slice(0, 10) : null
}

// 计划导入/导出字段：与 Excel 表头一一对应，导出的文件可直接重新导入
const PLAN_FIELDS = [
  { key: 'key', label: '编号（导入用）' },
  { key: 'project', label: '项目' },
  { key: 'seqNo', label: '序号' },
  { key: 'parentKey', label: '上级编号' },
  { key: 'title', label: '计划名称' },
  { key: 'category', label: '分类' },
  { key: 'predKeys', label: '前置任务编号' },
  { key: 'owner', label: '负责人' },
  { key: 'assistant1', label: '配合人1' },
  { key: 'assistant2', label: '配合人2' },
  { key: 'start_date', label: '开始日期' },
  { key: 'end_date', label: '结束日期' },
  { key: 'actual_start_date', label: '实际开始日期' },
  { key: 'actual_end_date', label: '实际完成日期' },
  { key: 'completion_rate', label: '完成比例' },
  { key: 'hours', label: '工时' },
  { key: 'man_days', label: '人天' },
  { key: 'status', label: '状态' },
  { key: 'note', label: '备注' },
  { key: 'sort', label: '排序' },
]
const PLAN_KEYS = PLAN_FIELDS.map((f) => f.key)
const PLAN_LABELS = Object.fromEntries(PLAN_FIELDS.map(({ key, label }) => [key, label]))
const PLAN_HEADER_TO_KEY = Object.fromEntries(PLAN_FIELDS.map(({ key, label }) => [label, key]))
const PLAN_REQUIRED = ['project', 'title']
const PLAN_MAX_LEN = { project: 32, title: 255, parentKey: 32, seqNo: 64, category: 100, owner: 64, assistant1: 64, assistant2: 64, status: 32 }

export const planImportFields = () => PLAN_FIELDS.map(({ key, label }) => ({ key, label }))

export async function exportPlans(scope, project) {
  const list = await listPlans(scope, project)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('项目计划')
  ws.columns = PLAN_FIELDS.map(({ key, label }) => ({
    header: label, key, width: ['title', 'note'].includes(key) ? 32 : 16,
  }))
  for (const r of list) {
    ws.addRow({
      key: r.id,
      project: r.project,
      seqNo: r.seq_no || '',
      parentKey: r.parent_id || '',
      title: r.title,
      category: r.category || '',
      predKeys: predecessorStr(r.predecessor) || '',
      owner: r.owner || '',
      assistant1: r.assistant1 || '',
      assistant2: r.assistant2 || '',
      start_date: r.start_date || '',
      end_date: r.end_date || '',
      actual_start_date: r.actual_start_date || '',
      actual_end_date: r.actual_end_date || '',
      completion_rate: Number(r.completion_rate || 0),
      hours: r.hours || 0,
      man_days: r.man_days || 0,
      status: r.status || '未开始',
      note: r.note || '',
      sort: r.sort || 0,
    })
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// mapping: { 字段key: Excel表头文字 }，由前端字段对照界面提交；无 mapping 时按默认表头自动映射
export async function importPlans(buffer, user, scope, mapping) {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer)
  } catch (e) {
    throw await structuralFail(buffer, `Excel 文件解析失败：${e.message}`)
  }
  const ws = wb.worksheets[0]
  if (!ws) throw await structuralFail(buffer, '文件无工作表')

  let headers
  try {
    headers = await readHeaders(buffer)
  } catch {
    throw await structuralFail(buffer, '首行未找到表头，请把表头放在第 1 行')
  }
  const headerCols = new Map(headers.map((h) => [h.label, h.col]))
  const colMap = {}
  if (mapping && Object.keys(mapping).length) {
    for (const [key, label] of Object.entries(mapping)) {
      if (!PLAN_KEYS.includes(key) || !label) continue
      const col = headerCols.get(String(label))
      if (!col) throw await structuralFail(buffer, `映射的源列「${label}」已不在文件中，请重新选择文件`)
      colMap[key] = col
    }
  } else {
    for (const [label, key] of Object.entries(PLAN_HEADER_TO_KEY)) {
      if (headerCols.has(label)) colMap[key] = headerCols.get(label)
    }
  }
  const missing = PLAN_REQUIRED.filter((f) => !colMap[f])
  if (missing.length) {
    throw await structuralFail(buffer, `未映射必填列：${missing.map((f) => PLAN_LABELS[f]).join('、')}`)
  }

  const errors = []
  const allRows = []
  const calendarMap = await getCalendarMap()
  const { rows: projectRows } = await pool.query('SELECT code FROM projects')
  const projectCodes = new Set(projectRows.map((row) => row.code))
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const vals = ws.getRow(r).values
    const obj = { row: r }
    let hasValue = false
    for (const [key, col] of Object.entries(colMap)) {
      obj[key] = cellValue(vals[col])
      if (obj[key]) hasValue = true
    }
    if (!hasValue) continue
    for (const f of PLAN_REQUIRED) {
      if (!obj[f]) errors.push({ row: r, field: PLAN_LABELS[f], message: '必填' })
    }
    for (const [f, max] of Object.entries(PLAN_MAX_LEN)) {
      if (!obj[f]) continue
      const len = [...obj[f]].length
      if (len > max) {
        errors.push({ row: r, field: PLAN_LABELS[f], message: `内容过长（最多 ${max} 字，当前 ${len} 字）` })
      }
    }
    if (obj.project) {
      const project = String(obj.project).trim()
      if (!projectCodes.has(project)) {
        errors.push({ row: r, field: '项目', message: `项目 ${project} 不存在` })
      } else if (scope && !scope.includes(project)) {
        errors.push({ row: r, field: '项目', message: `无权访问项目 ${project}` })
      }
    }
    const start_date = parseDate(obj.start_date)
    const end_date = parseDate(obj.end_date)
    const actual_start_date = parseDate(obj.actual_start_date)
    const actual_end_date = parseDate(obj.actual_end_date)
    for (const [f, raw, parsed] of [
      ['start_date', obj.start_date, start_date], ['end_date', obj.end_date, end_date],
      ['actual_start_date', obj.actual_start_date, actual_start_date],
      ['actual_end_date', obj.actual_end_date, actual_end_date],
    ]) {
      if (raw && !parsed) {
        errors.push({ row: r, field: PLAN_LABELS[f], message: `日期格式非法：${raw}（应为 YYYY-MM-DD）` })
      }
    }
    const completionRate = Number(obj.completion_rate) || 0
    if (obj.completion_rate && (Number.isNaN(Number(obj.completion_rate)) || completionRate < 0 || completionRate > 100)) {
      errors.push({ row: r, field: '完成比例', message: '须为 0~100 的数字' })
    }
    const hours = Number(obj.hours) || 0
    const manDays = Number(obj.man_days) || 0
    if (obj.hours && (Number.isNaN(Number(obj.hours)) || hours < 0 || hours > 99999999.99)) {
      errors.push({ row: r, field: '工时', message: '须为 0~99999999.99 的数字' })
    }
    if (obj.man_days && (Number.isNaN(Number(obj.man_days)) || manDays < 0 || manDays > 99999999.99)) {
      errors.push({ row: r, field: '人天', message: '须为 0~99999999.99 的数字' })
    }
    if (obj.sort && !Number.isInteger(Number(obj.sort))) {
      errors.push({ row: r, field: '排序', message: '须为整数' })
    }
    const metrics = calcPlanMetrics(start_date, end_date, calendarMap)
    const hasRange = !!(start_date && end_date)
    allRows.push({
      row: r,
      key: obj.key ? String(obj.key).trim() : '',
      project: obj.project ? String(obj.project).trim() : '',
      seqNo: obj.seqNo ? String(obj.seqNo).trim() : '',
      title: obj.title ? String(obj.title).trim() : '',
      parentKey: obj.parentKey ? String(obj.parentKey).trim() : '',
      predKeys: obj.predKeys ? String(obj.predKeys).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
      category: obj.category ? String(obj.category).trim() : null,
      owner: obj.owner ? String(obj.owner).trim() : null,
      assistant1: obj.assistant1 ? String(obj.assistant1).trim() : null,
      assistant2: obj.assistant2 ? String(obj.assistant2).trim() : null,
      start_date, end_date, actual_start_date, actual_end_date, completion_rate: completionRate,
      // 有起止日期时工时/人天一律按工作日历重算，忽略 Excel 中填写的数值
      hours: hasRange ? metrics.hours : hours,
      man_days: hasRange ? metrics.man_days : manDays,
      status: statusWithActual(obj.status ? String(obj.status).trim() : '', actual_start_date, actual_end_date),
      note: obj.note ? String(obj.note).trim() : null,
      sort: Number(obj.sort) || 0,
    })
  }
  if (!allRows.length) throw await structuralFail(buffer, '无有效数据行')

  // 序号推导层级：1.2 的上级为 1，1.2.3 的上级为 1.2；序号优先于“上级编号”列
  const seqKeyMap = new Map()
  for (const row of allRows) {
    if (row.seqNo && !seqKeyMap.has(row.seqNo)) {
      seqKeyMap.set(row.seqNo, row.key || `__seq_${row.seqNo}`)
    }
  }
  for (const row of allRows) {
    if (!row.seqNo) continue
    const parts = row.seqNo.split('.').filter(Boolean)
    if (parts.length <= 1) continue
    const parentSeq = parts.slice(0, -1).join('.')
    if (seqKeyMap.has(parentSeq)) row.parentKey = seqKeyMap.get(parentSeq)
    else if (!row.parentKey) errors.push({ row: row.row, field: '序号', message: `上级序号 ${parentSeq} 不在本次导入数据中` })
  }

  // 任务名称按前端编辑规则补全直接上级名称前缀（与前端 NAME_SEP 一致）
  const NAME_SEP = ' / '
  const rowByKey = new Map()
  for (const row of allRows) {
    if (row.key) rowByKey.set(row.key, row)
    if (row.seqNo) rowByKey.set(`__seq_${row.seqNo}`, row)
  }
  for (let pass = 0; pass < allRows.length; pass += 1) {
    let changed = false
    for (const row of allRows) {
      if (!row.parentKey) continue
      const parent = rowByKey.get(row.parentKey)
      if (!parent) continue
      const prefix = String(parent.title || '').trim()
      if (!prefix) continue
      const full = `${prefix}${NAME_SEP}`
      const clean = String(row.title || '').trim()
      if (clean && !clean.startsWith(full)) {
        row.title = `${full}${clean}`
        changed = true
      }
    }
    if (!changed) break
  }
  for (const row of allRows) {
    if ([...row.title].length > 255) {
      errors.push({ row: row.row, field: '计划名称', message: '补全上级名称后超过 255 字' })
    }
  }

  // 未填前置任务时，按导入顺序取同项目前一条有完成时间的记录作为前置；
  // 开始时间始终保留 Excel 导入值，不由该规则改写
  for (let i = 0; i < allRows.length; i += 1) {
    const row = allRows[i]
    if (row.predKeys.length) continue
    let prev = null
    for (let j = i - 1; j >= 0; j -= 1) {
      const candidate = allRows[j]
      if (candidate.project === row.project && candidate.end_date) {
        prev = candidate
        break
      }
    }
    if (!prev) continue
    const key = prev.key || (prev.seqNo ? `__seq_${prev.seqNo}` : '')
    if (!key) continue
    row.predKeys = [key]
  }

  // 层级引用必须在本次导入数据内可解析，否则整行进入失败清单，不写入半截数据
  const allKeys = new Set(allRows.flatMap((r) => [r.key, r.seqNo ? `__seq_${r.seqNo}` : ''].filter(Boolean)))
  for (const row of allRows) {
    if (row.parentKey && !allKeys.has(row.parentKey)) {
      errors.push({ row: row.row, field: '上级编号', message: `上级编号 ${row.parentKey} 不在本次导入数据中` })
    }
    const missingPreds = row.predKeys.filter((k) => !allKeys.has(k))
    if (missingPreds.length) {
      errors.push({ row: row.row, field: '前置任务编号', message: `编号 ${missingPreds.join('、')} 不在本次导入数据中` })
    }
  }
  const valid = allRows.filter((row) => !errors.some((e) => e.row === row.row))

  const client = await pool.connect()
  const parents = new Set()
  try {
    await client.query('BEGIN')
    let seq = await nextId(client)
    const idByKey = new Map()
    const idList = []
    for (const r of valid) {
      const id = `p${seq++}`
      idList.push(id)
      if (r.key) idByKey.set(r.key, id)
      if (r.seqNo) idByKey.set(`__seq_${r.seqNo}`, id)
      await client.query(
        `INSERT INTO project_plans(id, project, seq_no, title, owner, assistant1, assistant2, status,
           start_date, end_date, actual_start_date, actual_end_date, completion_rate,
           hours, man_days, sort, note, category, predecessor, track, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [id, r.project, r.seqNo || null, r.title, r.owner, r.assistant1, r.assistant2, r.status,
          r.start_date, r.end_date, r.actual_start_date, r.actual_end_date, r.completion_rate,
          r.hours, r.man_days, r.sort, r.note, r.category,
          null, JSON.stringify([]), user.username])
      await writePlanLogs(client, id, user, [['__create__', '', '导入计划']])
    }
    for (let i = 0; i < valid.length; i += 1) {
      const row = valid[i]
      if (row.parentKey) {
        const parentId = idByKey.get(row.parentKey)
        if (parentId) {
          try {
            await assertParent(client, parentId, row.project, idList[i])
            await client.query('UPDATE project_plans SET parent_id=$2 WHERE id=$1', [idList[i], parentId])
            parents.add(parentId)
          } catch (e) {
            errors.push({ row: row.row, field: '上级编号', message: e.message })
          }
        }
      }
      const preds = row.predKeys.map((k) => idByKey.get(k)).filter(Boolean)
      if (preds.length) {
        await client.query('UPDATE project_plans SET predecessor=$2 WHERE id=$1', [idList[i], preds.join(',')])
      }
    }
    for (const parentId of parents) await rollup(client, parentId)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    if (e.httpStatus) throw e
    console.error('[plan-import] 写入失败:', e.message)
    throw new HttpError(400, ERR.VALIDATION, `导入写入失败：${e.message}`)
  } finally {
    client.release()
  }

  const failedRows = allRows.filter((row) => errors.some((e) => e.row === row.row))
  const failUrl = failedRows.length ? await buildFailFile(buffer, ws, headers, failedRows, errors) : null
  return { imported: valid.length, failed: failedRows.length, errors, failUrl }
}
