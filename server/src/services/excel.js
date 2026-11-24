// Excel 导入/导出 + 图片上传（multer）
// 导出：COLS 排除虚拟列（ops/logs 由前端拼装，seq/操作/修改日志不在导出范围）
// 导入：中文表头映射 → 字段白名单，校验失败整批拒绝（40001 + 行明细）
import ExcelJS from 'exceljs'
import multer from 'multer'
import crypto from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { FIELD_LABELS, iterateIssuesForExport } from './issues.js'
import { getIssueExportLimit } from './settings.js'
import { pool } from '../db/pool.js'
import { config } from '../config/index.js'
import { HttpError, ERR } from '../utils/resp.js'
import { createPersonnel, updatePersonnel } from './archives.js'

// ---------- multer ----------
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new HttpError(400, ERR.VALIDATION, '仅支持图片文件'))
    cb(null, true)
  },
})
const anyUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

export const uploadImage = imageUpload.single('file')
export const uploadSingle = anyUpload.single('file')

// 导出列（COLS 去虚拟列：seq 保留为业务序号）
const EXPORT_KEYS = ['seq', 'project', 'stage', 'type', 'module', 'desc', 'priority', 'impact',
  'reporter', 'reported_at', 'owner', 'plan_start', 'plan_end', 'developer', 'solution',
  'pending_test', 'status', 'resolved_at', 'customer_test', 'customer_test_done']
// 中文表头（导入映射）
const HEADER_TO_KEY = Object.fromEntries(Object.entries(FIELD_LABELS).map(([k, v]) => [v, k]))

const fmt = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? ''))

export async function exportExcel(query, scope) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('问题跟踪')
  ws.columns = EXPORT_KEYS.map((k) => ({ header: FIELD_LABELS[k] ?? k, key: k, width: k === 'desc' || k === 'solution' ? 40 : 14 }))
  // 按当前筛选条件（含所选项目）分批读取；系统设置 limit=0 时导出全部记录
  const limit = await getIssueExportLimit(query.project)
  for await (const row of iterateIssuesForExport(query, scope, { limit })) {
    ws.addRow(Object.fromEntries(EXPORT_KEYS.map((k) => [k, fmt(row[k])])))
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// 可导入字段（问卷导出列，去掉业务序号）
const IMPORT_KEYS = EXPORT_KEYS.filter((k) => k !== 'seq')
export const importFields = () => IMPORT_KEYS.map((k) => ({ key: k, label: FIELD_LABELS[k] ?? k }))
const REQUIRED = ['project', 'desc', 'priority', 'status']
const DATE_KEYS = ['reported_at', 'plan_start', 'plan_end', 'resolved_at', 'customer_test_done']
// issues 表 varchar 长度约束（避免超长值写库时整批失败）
const MAX_LEN = {
  project: 32, stage: 64, type: 64, module: 64, priority: 8, impact: 8,
  reporter: 64, owner: 64, developer: 64, pending_test: 8, status: 32,
  customer_test: 8, image_url: 512,
}
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s
const clean = (v) => (v === null || v === undefined ? '' : String(v).trim())
const pad = (n) => String(n).padStart(2, '0')
export const cellValue = (v) => {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  const s = String(v).trim()
  // 常见 Excel 文本日期统一成 YYYY-MM-DD；N.A 等非日期保留原样，由行级校验拦截
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(s)
  return m ? `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}` : s
}

// 读取首行表头，供前端字段对照界面使用
export async function readHeaders(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new HttpError(400, ERR.VALIDATION, '文件无工作表')
  const headers = []
  ws.getRow(1).eachCell((cell, col) => {
    const label = clean(cell.value)
    if (label) headers.push({ col, label })
  })
  if (!headers.length) throw new HttpError(400, ERR.VALIDATION, '首行未找到表头')
  return headers
}

// 结构性错误（表头/映射问题）也生成清单：原表全部数据行 + 错误原因
async function buildStructuralFailFile(buffer, message) {
  const wb = new ExcelJS.Workbook()
  try { await wb.xlsx.load(buffer) } catch { /* 损坏文件也要给出可下载的清单 */ }
  const ws = wb.worksheets[0]
  const heads = []
  ws?.getRow(1).eachCell((cell, col) => {
    const label = clean(cell.value)
    if (label) heads.push({ col, label })
  })
  if (!heads.length) heads.push({ col: 1, label: '数据' })
  const out = new ExcelJS.Workbook()
  const sheet = out.addWorksheet('失败记录')
  sheet.addRow([...heads.map((h) => h.label), '导入错误'])
  if (ws) {
    for (let r = 2; r <= ws.rowCount; r++) {
      const vals = ws.getRow(r).values
      if (!vals.some((v) => v !== undefined && clean(v) !== '')) continue
      sheet.addRow([...heads.map((h) => cellValue(vals[h.col])), message])
    }
  }
  const name = `import-failed-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.xlsx`
  await mkdir(config.uploadDir, { recursive: true })
  await writeFile(path.join(config.uploadDir, name), Buffer.from(await out.xlsx.writeBuffer()))
  return `/uploads/${name}`
}
export const structuralFail = async (buffer, message) =>
  new HttpError(400, ERR.VALIDATION, message, { failUrl: await buildStructuralFailFile(buffer, message) })

// 失败清单：与原表相同列 + 错误说明，只保留失败行，供修改后重新导入
export async function buildFailFile(buffer, ws, headers, failedRows, errors) {
  const wb = new ExcelJS.Workbook()
  const out = wb.addWorksheet('失败记录')
  const labels = headers.map((h) => h.label)
  out.addRow([...labels, '导入错误'])
  for (const row of failedRows) {
    const vals = ws.getRow(row.row).values
    const detail = errors.filter((e) => e.row === row.row).map((e) => `${e.field}：${e.message}`).join('；')
    out.addRow([...headers.map((h) => cellValue(vals[h.col])), detail])
  }
  const name = `import-failed-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.xlsx`
  await mkdir(config.uploadDir, { recursive: true })
  await writeFile(path.join(config.uploadDir, name), Buffer.from(await wb.xlsx.writeBuffer()))
  return `/uploads/${name}`
}

// mapping: { 目标字段key: Excel表头文字 }，由前端字段对照界面提交
export async function importExcel(buffer, req, mapping) {
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
      if (!IMPORT_KEYS.includes(key) || !label) continue
      const col = headerCols.get(String(label))
      if (!col) throw await structuralFail(buffer, `映射的源列「${label}」已不在文件中，请重新选择文件`)
      colMap[key] = col
    }
  } else {
    for (const [label, key] of Object.entries(HEADER_TO_KEY)) {
      if (headerCols.has(label)) colMap[key] = headerCols.get(label)
    }
  }
  const missing = REQUIRED.filter((f) => !colMap[f])
  if (missing.length) {
    throw await structuralFail(buffer, `未映射必填列：${missing.map((f) => FIELD_LABELS[f]).join('、')}`)
  }

  const rows = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values
    const obj = { row: r }
    let hasValue = false
    for (const [key, col] of Object.entries(colMap)) {
      obj[key] = cellValue(vals[col])
      if (obj[key]) hasValue = true
    }
    if (hasValue) rows.push(obj)
  }
  if (!rows.length) throw await structuralFail(buffer, '无有效数据行')

  // 逐行校验：错误行跳过，其余照常写入
  const projects = (await pool.query('SELECT code FROM projects')).rows.map((r) => r.code)
  const scope = req.scope // null=全部
  const errors = []
  const valid = []
  rows.forEach((row) => {
    const before = errors.length
    for (const f of REQUIRED) {
      if (!row[f]) errors.push({ row: row.row, field: FIELD_LABELS[f], message: '必填' })
    }
    if (row.project && !projects.includes(row.project)) {
      errors.push({ row: row.row, field: '项目', message: `项目 ${row.project} 不存在` })
    } else if (scope && row.project && !scope.includes(row.project)) {
      errors.push({ row: row.row, field: '项目', message: `无权访问项目 ${row.project}` })
    }
    if (row.priority && !['C', 'H', 'M', 'L'].includes(row.priority)) {
      errors.push({ row: row.row, field: '优先级', message: '枚举非法' })
    }
    // 日期列行级校验：N.A / 文本 / 非法日期不得写库（否则整批 500）
    for (const f of DATE_KEYS) {
      if (row[f] && !validDate(row[f])) {
        errors.push({ row: row.row, field: FIELD_LABELS[f], message: `日期格式非法：${row[f]}（应为 YYYY-MM-DD）` })
      }
    }
    // 字段长度校验：如 影响程度/待测试/客户测试 为 varchar(8)
    for (const [f, max] of Object.entries(MAX_LEN)) {
      if (!row[f]) continue
      const len = [...row[f]].length
      if (len > max) {
        errors.push({ row: row.row, field: FIELD_LABELS[f],
          message: `内容过长（最多 ${max} 字，当前 ${len} 字）：${row[f].slice(0, 24)}` })
      }
    }
    if (errors.length === before) valid.push(row)
  })

  // 替换可见范围数据 + 逐行写入 __import__ 留痕
  const client = await pool.connect()
  let dbError = null
  try {
    await client.query('BEGIN')
    if (scope) await client.query('DELETE FROM issues WHERE project = ANY($1)', [scope])
    else await client.query('DELETE FROM issues')
    let seq = ((await client.query('SELECT COALESCE(MAX(seq),0)+1 AS n FROM issues')).rows[0].n) - 1
    for (const row of valid) {
      seq += 1
      const cols = ['seq', ...Object.keys(row).filter((k) => k !== 'row' && row[k] !== '')]
      const vals = cols.map((k) => (k === 'seq' ? seq : row[k]))
      const { rows: [issue] } = await client.query(
        `INSERT INTO issues(${cols.map((c) => (c === 'desc' ? '"desc"' : c)).join(', ')}, created_by)
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING id`,
        [...vals, req.profile.username])
      await client.query(
        'INSERT INTO issue_logs(issue_id, issue_seq, changed_by, field_key, field_label, before_value, after_value) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [issue.id, seq, req.profile.username, '__import__', '导入', '', String(seq)])
    }
    await client.query('COMMIT')
  } catch (e) {
    dbError = e
    try { await client.query('ROLLBACK') } catch { /* 连接已断开时忽略 */ }
  } finally {
    client.release()
  }
  // 写库异常也要给出可修正的失败清单，而不是 500
  if (dbError) throw await structuralFail(buffer, `导入写入失败：${dbError.message}`)

  const failedRows = rows.filter((r) => errors.some((e) => e.row === r.row))
  const failUrl = failedRows.length ? await buildFailFile(buffer, ws, headers, failedRows, errors) : null
  return { imported: valid.length, failed: failedRows.length, errors, failUrl }
}

// ---------- 人员档案导入/导出 ----------
const PERSONNEL_EXPORT_KEYS = ['code', 'name', 'role', 'group', 'projects', 'color', 'enabled', 'preset']
const PERSONNEL_LABELS = {
  code: '人员编码', name: '姓名', role: '岗位', group: '所属组',
  projects: '所属项目', color: '颜色', enabled: '启用', preset: '系统预置',
}
const PERSONNEL_HEADER_TO_KEY = Object.fromEntries(
  Object.entries(PERSONNEL_LABELS).map(([k, v]) => [v, k]))
const PERSONNEL_REQUIRED = ['code', 'name']
const PERSONNEL_MAX_LEN = { code: 16, name: 64, role: 32, group: 64, color: 32 }

export const personnelImportFields = () =>
  PERSONNEL_EXPORT_KEYS.map((k) => ({ key: k, label: PERSONNEL_LABELS[k] }))

const boolFromCell = (s) => {
  const v = clean(s).toLowerCase()
  if (['是', '启用', 'true', '1'].includes(v)) return true
  if (['否', '停用', 'false', '0'].includes(v)) return false
  return null
}
const projectsFromCell = (s) => clean(s).split(/[、,，;；\s]+/).filter(Boolean)

export async function exportPersonnelExcel() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('人员档案')
  ws.columns = PERSONNEL_EXPORT_KEYS.map((k) => ({
    header: PERSONNEL_LABELS[k], key: k, width: ['name', 'projects', 'group'].includes(k) ? 22 : 14,
  }))
  const { rows } = await pool.query(
    `SELECT p.code, p.name, r.name AS role, p."group", p.projects, p.color, p.enabled, p.preset
     FROM personnel p LEFT JOIN roles r ON r.code = p.role ORDER BY p.code`)
  for (const row of rows) {
    ws.addRow({
      ...row,
      projects: Array.isArray(row.projects) ? row.projects.join('、') : '',
      enabled: row.enabled ? '是' : '否',
      preset: row.preset ? '是' : '否',
    })
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function importPersonnelExcel(buffer, req, mapping) {
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
      if (!PERSONNEL_EXPORT_KEYS.includes(key) || !label) continue
      const col = headerCols.get(String(label))
      if (!col) throw await structuralFail(buffer, `映射的源列「${label}」已不在文件中，请重新选择文件`)
      colMap[key] = col
    }
  } else {
    for (const [label, key] of Object.entries(PERSONNEL_HEADER_TO_KEY)) {
      if (headerCols.has(label)) colMap[key] = headerCols.get(label)
    }
  }
  const missing = PERSONNEL_REQUIRED.filter((f) => !colMap[f])
  if (missing.length) {
    throw await structuralFail(buffer, `未映射必填列：${missing.map((f) => PERSONNEL_LABELS[f]).join('、')}`)
  }

  const rows = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values
    const obj = { row: r }
    let hasValue = false
    for (const [key, col] of Object.entries(colMap)) {
      obj[key] = cellValue(vals[col])
      if (obj[key]) hasValue = true
    }
    if (hasValue) rows.push(obj)
  }
  if (!rows.length) throw await structuralFail(buffer, '无有效数据行')

  const [personnelRows, roleRows, projectRows] = await Promise.all([
    pool.query('SELECT code, name FROM personnel'),
    pool.query('SELECT code, name FROM roles'),
    pool.query('SELECT code FROM projects'),
  ])
  const existingByCode = new Map(personnelRows.rows.map((r) => [r.code, r.code]))
  const existingByName = new Map(personnelRows.rows.map((r) => [r.name, r.code]))
  const roleByCode = new Map(roleRows.rows.map((r) => [r.code, r.code]))
  const roleByName = new Map(roleRows.rows.map((r) => [r.name, r.code]))
  const projectCodes = new Set(projectRows.rows.map((r) => r.code))
  const seenCodes = new Set()
  const seenNames = new Set()
  const errors = []
  const valid = []

  rows.forEach((row) => {
    const before = errors.length
    for (const f of PERSONNEL_REQUIRED) {
      if (!row[f]) errors.push({ row: row.row, field: PERSONNEL_LABELS[f], message: '必填' })
    }
    for (const [f, max] of Object.entries(PERSONNEL_MAX_LEN)) {
      if (!row[f]) continue
      const len = [...row[f]].length
      if (len > max) {
        errors.push({ row: row.row, field: PERSONNEL_LABELS[f],
          message: `内容过长（最多 ${max} 字，当前 ${len} 字）` })
      }
    }
    if (row.code) {
      if (seenCodes.has(row.code)) errors.push({ row: row.row, field: '人员编码', message: '文件内重复' })
      seenCodes.add(row.code)
    }
    if (row.name) {
      if (seenNames.has(row.name)) errors.push({ row: row.row, field: '姓名', message: '文件内重复' })
      const boundCode = existingByName.get(row.name)
      if (boundCode && row.code && boundCode !== row.code) {
        errors.push({ row: row.row, field: '姓名', message: `已被人员 ${boundCode} 使用` })
      }
      seenNames.add(row.name)
    }
    row._data = {}
    if (colMap.role && row.role) {
      const roleCode = roleByCode.get(row.role) || roleByName.get(row.role)
      if (!roleCode) errors.push({ row: row.row, field: '岗位', message: `角色档案中不存在：${row.role}` })
      else row._data.role = roleCode
    }
    if (colMap.projects) {
      const list = projectsFromCell(row.projects)
      for (const code of list) {
        if (code !== 'ALL' && !projectCodes.has(code)) {
          errors.push({ row: row.row, field: '所属项目', message: `项目 ${code} 不存在` })
        }
      }
      row._data.projects = [...new Set(list)]
    }
    for (const f of ['enabled', 'preset']) {
      if (!colMap[f] || row[f] === '') continue
      const value = boolFromCell(row[f])
      if (value === null) errors.push({ row: row.row, field: PERSONNEL_LABELS[f], message: '请填 是/否' })
      else row._data[f] = value
    }
    for (const f of ['code', 'name', 'group', 'color']) {
      if (colMap[f]) row._data[f] = row[f] || ''
    }
    if (errors.length === before) valid.push(row)
  })

  let imported = 0
  for (const row of valid) {
    try {
      if (existingByCode.has(row.code)) await updatePersonnel(row.code, row._data)
      else await createPersonnel(row._data)
      imported += 1
    } catch (e) {
      errors.push({ row: row.row, field: '写入', message: e.message })
    }
  }
  const failedRows = rows.filter((r) => errors.some((e) => e.row === r.row))
  const failUrl = failedRows.length ? await buildFailFile(buffer, ws, headers, failedRows, errors) : null
  return { imported, failed: failedRows.length, errors, failUrl }
}
