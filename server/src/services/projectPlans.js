// 项目计划：编写/导入/层级汇总（父级时间与工时由下级自动汇总）
import ExcelJS from 'exceljs'
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'

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
  hours: Number(r.hours || 0),
  has_children: !!r.has_children,
})

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
    `SELECT p.*, EXISTS(SELECT 1 FROM project_plans c WHERE c.parent_id=p.id) AS has_children
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

// 从当前节点向上逐级重算：有下级时以 min(开始) / max(结束) / sum(工时) 覆盖
async function rollup(client, id) {
  const seen = new Set()
  while (id && !seen.has(id)) {
    seen.add(id)
    const { rows } = await client.query(
      `SELECT count(*)::int c, min(start_date) s, max(end_date) e, COALESCE(sum(hours),0) h
       FROM project_plans WHERE parent_id=$1`, [id])
    if (rows[0].c > 0) {
      await client.query(
        'UPDATE project_plans SET start_date=$2, end_date=$3, hours=$4, updated_at=now() WHERE id=$1',
        [id, rows[0].s, rows[0].e, rows[0].h])
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

export async function listPlans(scope) {
  const { rows } = await pool.query(
    `SELECT p.*, EXISTS(SELECT 1 FROM project_plans c WHERE c.parent_id=p.id) AS has_children
     FROM project_plans p
     WHERE $1::text[] IS NULL OR p.project = ANY($1::text[])
     ORDER BY p.project, p.sort, p.created_at, p.id`, [scope || null])
  return rows.map(out)
}

export async function createPlan(body, user, scope) {
  await assertVisible(scope, body.project)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const id = `p${await nextId(client)}`
    const parentId = await assertParent(client, body.parent_id || null, body.project)
    await client.query(
      `INSERT INTO project_plans(id, project, parent_id, title, owner, start_date, end_date, hours, sort, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, body.project, parentId, body.title, body.owner || null, body.start_date || null,
        body.end_date || null, Number(body.hours || 0), Number(body.sort || 0), body.note || null, user.username])
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

export async function updatePlan(id, body, scope) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await getRow(client, id)
    const project = body.project || current.project
    await assertVisible(scope, project)
    if (project !== current.project && (current.parent_id || current.has_children)) {
      throw new HttpError(400, ERR.VALIDATION, '有上下级关系的计划不能修改项目')
    }
    const parentId = await assertParent(client,
      body.parent_id === undefined ? current.parent_id : (body.parent_id || null), project, id)
    await client.query(
      `UPDATE project_plans SET project=$2, parent_id=$3, title=$4, owner=$5, start_date=$6,
         end_date=$7, hours=$8, sort=$9, note=$10, updated_at=now()
       WHERE id=$1`,
      [id, project, parentId, body.title ?? current.title, body.owner ?? current.owner,
        body.start_date ?? current.start_date, body.end_date ?? current.end_date,
        Number(body.hours ?? current.hours), Number(body.sort ?? current.sort), body.note ?? current.note])
    await rollup(client, id)
    await client.query('COMMIT')
    return getRow(client, id)
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

const HEADERS = ['编号（导入用）', '项目', '上级编号', '计划名称', '负责人', '开始日期', '结束日期', '工时', '备注', '排序']

export async function templateBuffer() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('项目计划')
  ws.columns = HEADERS.map((header) => ({ header, key: header, width: 16 }))
  ws.addRow({
    '编号（导入用）': 'P001', 项目: 'DMS-2026', 上级编号: '', 计划名称: '示例：价格管理模块',
    负责人: '张晓林', 开始日期: '2026-12-01', 结束日期: '2026-12-31', 工时: 80, 备注: '父级工时/时间由下级汇总', 排序: 1,
  })
  ws.addRow({
    '编号（导入用）': 'P002', 项目: 'DMS-2026', 上级编号: 'P001', 计划名称: '示例：需求确认',
    负责人: '张晓林', 开始日期: '2026-12-01', 结束日期: '2026-12-10', 工时: 24, 备注: '', 排序: 1,
  })
  ws.getRow(1).font = { bold: true }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function importPlans(buffer, user, scope) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new HttpError(400, ERR.VALIDATION, 'Excel 无有效工作表')

  const headers = ws.getRow(1).values.slice(1).map((v) => String(v || '').trim())
  const idx = (name) => headers.findIndex((h) => h.includes(name.replace('（导入用）', '')))
  const col = (row, name) => row.values[idx(name) + 1]
  const errors = []
  const rows = []
  for (let i = 2; i <= ws.rowCount; i += 1) {
    const row = ws.getRow(i)
    const key = col(row, '编号（导入用）') ? String(col(row, '编号（导入用）')).trim() : ''
    const project = col(row, '项目') ? String(col(row, '项目')).trim() : ''
    const title = col(row, '计划名称') ? String(col(row, '计划名称')).trim() : ''
    if (!project || !title) {
      if (key || project || title) errors.push(`第 ${i} 行：项目和计划名称必填`)
      continue
    }
    if (scope && !scope.includes(project)) {
      errors.push(`第 ${i} 行：无权访问项目 ${project}`)
      continue
    }
    rows.push({
      key, project, title,
      parentKey: col(row, '上级编号') ? String(col(row, '上级编号')).trim() : '',
      owner: col(row, '负责人') ? String(col(row, '负责人')).trim() : null,
      start_date: parseDate(col(row, '开始日期')),
      end_date: parseDate(col(row, '结束日期')),
      hours: Number(col(row, '工时')) || 0,
      note: col(row, '备注') ? String(col(row, '备注')).trim() : null,
      sort: Number(col(row, '排序')) || 0,
    })
  }
  if (!rows.length) throw new HttpError(400, ERR.VALIDATION, 'Excel 无有效计划数据')

  const client = await pool.connect()
  const parents = new Set()
  try {
    await client.query('BEGIN')
    let seq = await nextId(client)
    const idByKey = new Map()
    const idList = []
    for (const r of rows) {
      const id = `p${seq++}`
      idList.push(id)
      if (r.key) idByKey.set(r.key, id)
      await client.query(
        `INSERT INTO project_plans(id, project, title, owner, start_date, end_date, hours, sort, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, r.project, r.title, r.owner, r.start_date, r.end_date, r.hours, r.sort, r.note, user.username])
    }
    for (let i = 0; i < rows.length; i += 1) {
      if (!rows[i].parentKey) continue
      const parentId = idByKey.get(rows[i].parentKey)
      if (!parentId) {
        errors.push(`第 ${i + 2} 行：上级编号 ${rows[i].parentKey} 不在本次导入数据中`)
        continue
      }
      try {
        await assertParent(client, parentId, rows[i].project, idList[i])
        await client.query('UPDATE project_plans SET parent_id=$2 WHERE id=$1', [idList[i], parentId])
        parents.add(parentId)
      } catch (e) {
        errors.push(`第 ${i + 2} 行：${e.message}`)
      }
    }
    for (const parentId of parents) await rollup(client, parentId)
    await client.query('COMMIT')
    return { imported: rows.length, errors }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
