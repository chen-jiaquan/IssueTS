// 统计透视服务（见 docs/API契约.md 第 3 节）
// 口径与列表可见项目一致；高频结果进程内缓存 TTL 120s，问题写入后失效
import ExcelJS from 'exceljs'
import { pool } from '../db/pool.js'
import { listIssues } from './issues.js'

// 行维度 → 实际字段（dim=owner 时按 personField 二选一）
export const DIM_FIELD = {
  owner: null, project: 'project', status: 'status', module: 'module',
  priority: 'priority', type: 'type',
}
const TIME_FIELD = { planEnd: 'plan_end', resolvedAt: 'resolved_at' }
const BLANK = '（空）'

const pad = (n) => String(n).padStart(2, '0')
// Date → 本地 YYYY-MM-DD（pg DATE 按本地零点返回，用 UTC 会偏移一天）
const ymd = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  : String(v).slice(0, 10))

// 周桶：周一日期（与原型 bucketKey 一致，用 UTC 计算避免时区漂移）
function weekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay()
  dt.setUTCDate(dt.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return dt.toISOString().slice(0, 10)
}
function bucketKey(value, gran) {
  if (!value) return BLANK
  const s = ymd(value)
  if (gran === 'month') return s.slice(0, 7)
  if (gran === 'week') return weekStart(s)
  return s
}

// ---------- 进程内缓存（TTL 120s） ----------
const cache = new Map() // key -> { expires, value }
const TTL = 120 * 1000
export function invalidatePivotCache() {
  for (const k of [...cache.keys()]) if (k.startsWith('pivot:')) cache.delete(k)
}
const cacheGet = (key) => {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  cache.delete(key)
  return null
}
const cacheSet = (key, value) => cache.set(key, { expires: Date.now() + TTL, value })

// ---------- 透视 ----------
export async function pivot(query, scope) {
  const dim = query.dim || 'owner'
  const personField = dim === 'owner' ? (query.personField === 'developer' ? 'developer' : 'owner') : null
  const field = dim === 'owner' ? personField : DIM_FIELD[dim]
  const timeField = TIME_FIELD[query.timeField || 'planEnd']
  const gran = query.granularity || 'month'

  const key = `pivot:${JSON.stringify([query, scope])}`
  const hit = cacheGet(key)
  if (hit) return hit

  const { list } = await listIssues({ page: 1, pageSize: 200, ...query }, scope)
  const rows = new Map()
  const cols = new Map()
  const matrix = {}

  for (const it of list) {
    const rowVal = it[field] || BLANK
    const colVal = bucketKey(it[timeField], gran)
    if (query.rowFilter && !String(query.rowFilter).split(',').includes(rowVal)) continue
    rows.set(rowVal, (rows.get(rowVal) || 0) + 1)
    cols.set(colVal, (cols.get(colVal) || 0) + 1)
    ;(matrix[rowVal] ??= {})
    matrix[rowVal][colVal] = (matrix[rowVal][colVal] || 0) + 1
  }

  // 列排序（时间桶升序，空桶最后）
  const sortedCols = [...cols.keys()].sort((a, b) => {
    if (a === BLANK) return 1
    if (b === BLANK) return -1
    return a < b ? -1 : a > b ? 1 : 0
  })
  // 行排序：按行合计降序
  const sortedRows = [...rows.keys()].sort((a, b) => rows.get(b) - rows.get(a))
  const rowTotals = Object.fromEntries(sortedRows.map((r) => [r, rows.get(r)]))
  const colTotals = Object.fromEntries(sortedCols.map((c) => [c, cols.get(c)]))
  const result = {
    dim, field, timeField, granularity: gran,
    rows: sortedRows, cols: sortedCols,
    matrix: Object.fromEntries(sortedRows.map((r) => [
      r, Object.fromEntries(sortedCols.map((c) => [c, matrix[r][c] || 0])),
    ])),
    rowTotals, colTotals, grandTotal: list.length,
  }
  cacheSet(key, result)
  return result
}

// ---------- 透视导出（xlsx：行维度×时间桶 + 合计列/行） ----------
export async function exportPivot(query, scope) {
  const data = await pivot(query, scope)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('统计透视')
  const dimLabel = { owner: data.personField === 'developer' ? '开发人员' : '负责人', project: '项目', status: '状态', module: '模块', priority: '优先级', type: '类型' }[data.dim]
  const colHeaders = [...data.cols, '合计']
  ws.columns = [
    { header: dimLabel, key: 'row', width: 20 },
    ...colHeaders.map((c) => ({ header: c, key: c, width: 14 })),
  ]
  for (const r of data.rows) {
    ws.addRow({ row: r, ...Object.fromEntries(colHeaders.map((c) => [c, c === '合计' ? data.rowTotals[r] : data.matrix[r][c] || 0])) })
  }
  const totalRow = { row: '合计', ...Object.fromEntries(colHeaders.map((c) => [c, c === '合计' ? data.grandTotal : data.colTotals[c] || 0])) }
  ws.addRow(totalRow)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
