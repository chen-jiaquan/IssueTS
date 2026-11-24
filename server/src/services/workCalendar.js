// 工作日历：按年维护节假日/调休补班，并为项目计划提供工作日、人天、工时计算。
import { pool } from '../db/pool.js'
import { HttpError, ERR } from '../utils/resp.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_HOURS = 8
const DAY_MS = 86400000

const normDate = (v) => {
  if (!v) return null
  if (v instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  }
  const s = String(v).slice(0, 10)
  return DATE.test(s) ? s : null
}
const toUTC = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const iso = (d) => d.toISOString().slice(0, 10)
const out = (r) => ({
  year: Number(r.year),
  holidays: (r.holidays || []).map(normDate).filter(Boolean).sort(),
  workdays: (r.workdays || []).map(normDate).filter(Boolean).sort(),
  hours_per_day: Number(r.hours_per_day ?? DEFAULT_HOURS),
})

export async function listCalendars() {
  const { rows } = await pool.query('SELECT * FROM work_calendars ORDER BY year')
  return rows.map(out)
}

export async function getCalendarMap() {
  const rows = await listCalendars()
  return new Map(rows.map((c) => [c.year, c]))
}

export async function saveCalendar(year, body) {
  const y = Number(year)
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new HttpError(400, ERR.VALIDATION, '年份非法', [{ field: 'year' }])
  }
  const dates = (value, field) => {
    const list = Array.isArray(value) ? value : []
    const bad = list.find((d) => {
      const s = normDate(d)
      return !s || Number(s.slice(0, 4)) !== y
    })
    if (bad) throw new HttpError(400, ERR.VALIDATION, `${field} 只能填写 ${y} 年的日期`, [{ field }])
    return [...new Set(list.map(normDate))].sort()
  }
  const holidays = dates(body?.holidays, 'holidays')
  const workdays = dates(body?.workdays, 'workdays')
  const hours = Number(body?.hours_per_day ?? DEFAULT_HOURS)
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new HttpError(400, ERR.VALIDATION, '每日工时须在 0~24 之间', [{ field: 'hours_per_day' }])
  }
  const { rows } = await pool.query(
    `INSERT INTO work_calendars(year, holidays, workdays, hours_per_day)
     VALUES ($1,$2::date[],$3::date[],$4)
     ON CONFLICT (year) DO UPDATE SET holidays=EXCLUDED.holidays, workdays=EXCLUDED.workdays,
       hours_per_day=EXCLUDED.hours_per_day, updated_at=now()
     RETURNING *`,
    [y, holidays, workdays, hours])
  return out(rows[0])
}

// 中国政府网年度节假日安排通知（公开页面）
const GOV_NOTICE_URLS = {
  2024: 'https://www.gov.cn/gongbao/2023/issue_10806/202311/content_6913823.html',
  2025: 'https://www.gov.cn/zhengce/content/202411/content_6986382.htm',
  2026: 'https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html',
  2027: 'https://www.gov.cn/zhengce/content/202611/content_7085101.htm',
}

const htmlToText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  .join('\n')

// 从通知正文提取放假区间、调休上班日与节日名称。
export function parseGovNotice(html, year) {
  const y = Number(year)
  const pad = (n) => String(n).padStart(2, '0')
  const key = (m, d) => `${y}-${pad(m)}-${pad(d)}`
  const holidays = new Set()
  const workdays = new Set()
  const names = {}
  const addRange = (sm, sd, em, ed) => {
    const cur = new Date(Date.UTC(y, sm - 1, sd))
    const last = new Date(Date.UTC(y, em - 1, ed))
    while (cur <= last) {
      holidays.add(key(cur.getUTCMonth() + 1, cur.getUTCDate()))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
  }
  let currentName = ''
  for (const raw of htmlToText(html).split('\n')) {
    const line = raw.replace(/\s+/g, '')
    const title = line.match(/^[一二三四五六七]、([^：]+)：?$/)
    if (title) {
      currentName = title[1]
      continue
    }
    for (const clause of line.split('。')) {
      if (!clause.includes('上班')) continue
      const re = /(\d{1,2})月(\d{1,2})日(?:（[^）]*）)?/g
      let m
      while ((m = re.exec(clause))) workdays.add(key(Number(m[1]), Number(m[2])))
    }
    if (!line.includes('放假')) continue
    const range = line.match(/(\d{1,2})月(\d{1,2})日(?:（[^）]*）)?至(?:(\d{1,2})月)?(\d{1,2})日/)
    if (range) {
      const sm = Number(range[1])
      const sd = Number(range[2])
      const em = range[3] ? Number(range[3]) : sm
      const ed = Number(range[4])
      if (currentName) names[key(sm, sd)] = currentName
      addRange(sm, sd, em, ed)
      continue
    }
    const single = line.match(/(\d{1,2})月(\d{1,2})日(?:（[^）]*）)?放假/)
    if (single) {
      const start = key(Number(single[1]), Number(single[2]))
      if (currentName) names[start] = currentName
      holidays.add(start)
    }
  }
  return { year: y, holidays: [...holidays].sort(), workdays: [...workdays].sort(), names }
}

export async function fetchGovCalendar(year) {
  const y = Number(year)
  const url = GOV_NOTICE_URLS[y]
  if (!url) throw new HttpError(400, ERR.VALIDATION, `暂未配置 ${y} 年政府网通知地址`)
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } })
  } catch (e) {
    throw new HttpError(502, ERR.SERVER, '访问中国政府网失败', [{ message: e.message }])
  }
  if (!response.ok) throw new HttpError(502, ERR.SERVER, `中国政府网返回 ${response.status}`)
  const data = parseGovNotice(await response.text(), y)
  if (!data.holidays.length) throw new HttpError(502, ERR.SERVER, '政府网通知未解析出放假日期')
  return { ...data, source: url }
}

// 起止日期闭区间内的工作日数；工作日=周一至周五且非节假日，或显式配置的调休补班日。
export function calcPlanMetrics(start, end, calendarMap = new Map()) {
  const s = normDate(start)
  const e = normDate(end)
  if (!s || !e || e < s) return { work_days: 0, man_days: 0, hours: 0 }
  let cur = toUTC(s)
  const last = toUTC(e)
  let workDays = 0
  let hours = 0
  while (cur <= last) {
    const key = iso(cur)
    const cal = calendarMap.get(Number(key.slice(0, 4))) || { holidays: [], workdays: [], hours_per_day: DEFAULT_HOURS }
    const isWorkday = !cal.holidays.includes(key) && (cal.workdays.includes(key) || cur.getUTCDay() !== 0 && cur.getUTCDay() !== 6)
    if (isWorkday) {
      workDays += 1
      hours += Number(cal.hours_per_day || DEFAULT_HOURS)
    }
    cur = new Date(cur.getTime() + DAY_MS)
  }
  return { work_days: workDays, man_days: workDays, hours: Math.round(hours * 100) / 100 }
}
