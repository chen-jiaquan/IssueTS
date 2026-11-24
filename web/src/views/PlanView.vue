<script setup>
// 项目计划：Excel 式清单（批量新增 / 行内编辑 / 双击卡片编辑）+ 甘特条 + 工作日历
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import TrackRecords from '@/components/TrackRecords.vue'
import { useAuthStore } from '@/store/auth'
import http from '@/api/http'
import {
  listPlans, deletePlan, batchSavePlans, planLogs,
  importPlans, planImportFields as fetchPlanImportFields, readPlanImportHeaders, exportPlans,
  listCalendars, saveCalendar, fetchGovCalendar,
} from '@/api/projectPlans'
import { calendarData } from '@/utils/statutoryHolidays'

const auth = useAuthStore()
const filter = reactive({ project: '' })
const projectMeta = ref([])
const statusOptions = ref([])
const plans = ref([])
const rows = ref([])
const selection = ref([])
const leftTable = ref(null)
const ganttScroll = ref(null)
const planGrid = ref(null)
const gridHeight = ref(520)
const leftPaneWidth = ref(760)
const dragging = ref(false)
const loading = ref(false)
const saving = ref(false)
const showMore = ref(false)
const editingCell = ref('')
const dialog = ref(false)
const editing = ref(null)
const tmpSeq = ref(1)
const form = reactive({
  project: '', parent_id: '', parentReady: true, title: '', category: '', status: '未开始',
  owner: '', assistant1: '', assistant2: '',
  start_date: '', end_date: '', hours: 0, man_days: 0, sort: 0, note: '', predecessor: [], track: [],
})
const logDialog = ref(false)
const logList = ref([])
const logTitle = ref('')
const calendars = ref([])
const calendarDialog = ref(false)
const calendarYear = ref(new Date().getFullYear())
const calendarMonths = Array.from({ length: 12 }, (_, i) => i + 1)
const calendarDirty = ref(false)
const calendarForm = reactive({ holidays: [], workdays: [], hours_per_day: 8 })
const govNames = ref({})
const weekNames = ['一', '二', '三', '四', '五', '六', '日']

// ---------- Excel 导入/导出 ----------
const exportBusy = ref(false)
const planImportDialog = ref(false)
const planImportBusy = ref(false)
const planImportFile = ref(null)
const planImportFieldsList = ref([])
const planImportHeaders = ref([])
const planImportMapping = reactive({})
const planImportResult = ref(null)

const projectOptions = computed(() => projectMeta.value.map((p) => ({ value: p.code, label: p.name || p.code })))
const categoryOptions = computed(() => {
  const set = new Set(['需求', '设计', '开发', '测试', '交付', '管理'])
  rows.value.forEach((r) => { if (r.category) set.add(r.category) })
  return [...set]
})
const statusLabel = (v) => statusOptions.value.find((o) => o.value === v)?.label || v || '—'
const statusTagStyle = (v) => {
  const color = statusOptions.value.find((o) => o.value === v)?.color
  return color && /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(color)
    ? { backgroundColor: color, borderColor: color, color: '#fff' } : {}
}
const rowById = computed(() => Object.fromEntries(rows.value.map((r) => [r.id, r])))
const NAME_SEP = ' / '
function parentName(parentId) {
  const parent = parentId ? rowById.value[parentId] : null
  return parent ? String(parent.title || '').trim() : ''
}
function withParentPrefix(title, parentId) {
  const prefix = parentName(parentId)
  const clean = String(title || '').trim()
  if (!prefix) return clean
  const full = `${prefix}${NAME_SEP}`
  return clean.startsWith(full) ? clean : `${full}${clean}`
}
const parentLabel = (row) => {
  if (!row.parent_id) return row.parentReady ? '一级任务（无上级）' : '请选择上级任务'
  const parent = rowById.value[row.parent_id]
  return parent ? `${parent.wbs} ${parent.title}` : row.parent_id
}
function setRowParent(row, value) {
  row.parent_id = value === '__root__' ? null : value
  row.parentReady = true
  row._dirty = true
  if (row._new) row.title = withParentPrefix(row.title, row.parent_id)
}
function commitParent(row, value) {
  setRowParent(row, value)
  editingCell.value = `${row.id}:title`
}
const rowOptions = computed(() => rows.value.map((r) => ({ value: r.id, label: `${r.wbs} ${r.title}` })))
const predecessorLabel = (row) => (row.predecessor || []).map((id) => {
  const r = rowById.value[id]
  return r ? `${r.wbs} ${r.title}` : id
}).join('、')
const lastTrack = (row) => (row.track || []).at(-1) || null
const fmtTime = (t) => String(t).slice(0, 19).replace('T', ' ')
async function openLogs(row) {
  try {
    logTitle.value = `任务「${row.title}」修改日志`
    logList.value = await planLogs(row.id)
    logDialog.value = true
  } catch (e) { ElMessage.error(e.message) }
}
const isDesc = (candidateId, ancestorId) => {
  if (!ancestorId) return false
  let cur = rowById.value[candidateId]
  const seen = new Set()
  while (cur?.parent_id && !seen.has(cur.id)) {
    if (cur.parent_id === ancestorId) return true
    seen.add(cur.id)
    cur = rowById.value[cur.parent_id]
  }
  return false
}
const parentOptions = computed(() => rows.value.filter((p) =>
  p.project === form.project && p.id !== editing.value?.id && !isDesc(p.id, editing.value?.id)))
const hasDirty = computed(() => rows.value.some((r) => r._dirty))
const isEmptyDraft = (r) => !!r._new && !String(r.title || '').trim() && !r.category && !r.owner
  && !r.start_date && !r.end_date && !(r.predecessor || []).length && !String(r.note || '').trim()
const emptyDraftCount = computed(() => rows.value.filter(isEmptyDraft).length)
const rolledUp = computed(() => !!editing.value?.has_children)
const autoCalc = computed(() => !!(form.start_date && form.end_date))
const totalHours = computed(() => plans.value.filter((p) => !p.parent_id)
  .reduce((sum, p) => sum + Number(p.hours || 0), 0))
const totalManDays = computed(() => plans.value.filter((p) => !p.parent_id)
  .reduce((sum, p) => sum + Number(p.man_days || 0), 0))
const editingRowId = computed(() => (editingCell.value ? editingCell.value.split(':')[0] : ''))
const rowClass = ({ row }) => {
  const classes = []
  if (row._dirty) classes.push('dirty-row')
  if (selection.value.some((s) => s.id === row.id)) classes.push('selected-row')
  if (editingRowId.value === row.id) classes.push('editing-row')
  return classes.join(' ')
}

let syncingScroll = false
function onLeftScroll({ scrollTop }) {
  if (syncingScroll || !ganttScroll.value) return
  syncingScroll = true
  ganttScroll.value.scrollTop = scrollTop || 0
  requestAnimationFrame(() => { syncingScroll = false })
}
function onGanttScroll() {
  if (syncingScroll || !leftTable.value) return
  const wrap = leftTable.value.bodyWrapper || leftTable.value.$el?.querySelector('.el-scrollbar__wrap')
  if (!wrap) return
  syncingScroll = true
  wrap.scrollTop = ganttScroll.value.scrollTop
  requestAnimationFrame(() => { syncingScroll = false })
}
const MIN_LEFT_WIDTH = 520
const MIN_RIGHT_WIDTH = 300
function clampLeftWidth(width) {
  const total = planGrid.value?.clientWidth || 1200
  return Math.max(MIN_LEFT_WIDTH, Math.min(width, Math.max(MIN_LEFT_WIDTH, total - MIN_RIGHT_WIDTH)))
}
function relayoutTable() {
  requestAnimationFrame(() => leftTable.value?.doLayout?.())
}
function onResizeMove(e) {
  if (!dragging.value || !planGrid.value) return
  const rect = planGrid.value.getBoundingClientRect()
  leftPaneWidth.value = clampLeftWidth(e.clientX - rect.left)
  relayoutTable()
}
function stopResize() {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}
function startResize(e) {
  if (e.button !== 0) return
  e.preventDefault()
  dragging.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize)
}
function resetResize() {
  const total = planGrid.value?.clientWidth || 1200
  leftPaneWidth.value = clampLeftWidth(Math.round(total * 0.6))
  relayoutTable()
}
function updateGridHeight() {
  gridHeight.value = Math.max(360, Math.min(720, window.innerHeight - 300))
  if (planGrid.value) leftPaneWidth.value = clampLeftWidth(leftPaneWidth.value)
}

// 与后端 workCalendar 使用同一规则：周末休息，节假日优先，调休工作日覆盖周末。
function calcMetrics(start, end) {
  if (!start || !end || end < start) return { hours: 0, manDays: 0 }
  const byYear = new Map(calendars.value.map((c) => [Number(c.year), c]))
  const toDate = (s) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }
  const iso = (d) => d.toISOString().slice(0, 10)
  let cur = toDate(start)
  const last = toDate(end)
  let manDays = 0
  let hours = 0
  while (cur <= last) {
    const key = iso(cur)
    const cal = byYear.get(Number(key.slice(0, 4))) || { holidays: [], workdays: [], hours_per_day: 8 }
    const holiday = (cal.holidays || []).includes(key)
    const makeup = (cal.workdays || []).includes(key)
    const day = cur.getUTCDay()
    if (!holiday && (makeup || (day !== 0 && day !== 6))) {
      manDays += 1
      hours += Number(cal.hours_per_day || 8)
    }
    cur = new Date(cur.getTime() + 86400000)
  }
  return { hours: Math.round(hours * 100) / 100, manDays }
}
const workDays = (start, end) => calcMetrics(start, end).manDays
function applyCalc() {
  if (!autoCalc.value) return
  const m = calcMetrics(form.start_date, form.end_date)
  form.hours = m.hours
  form.man_days = m.manDays
}
watch(() => [form.start_date, form.end_date], applyCalc)
watch(() => form.parent_id, (val, oldVal) => {
  form.parentReady = !!val
  if (!editing.value?._new) return
  let clean = String(form.title || '').trim()
  const oldPrefix = parentName(oldVal)
  if (oldPrefix) {
    const oldFull = `${oldPrefix}${NAME_SEP}`
    if (clean.startsWith(oldFull)) clean = clean.slice(oldFull.length)
  }
  form.title = withParentPrefix(clean, val)
})

function buildTree(source) {
  const clones = source.map((p) => ({
    ...p,
    category: p.category || '',
    status: p.status || '未开始',
    parentReady: p.parentReady !== false,
    assistant1: p.assistant1 || '',
    assistant2: p.assistant2 || '',
    track: Array.isArray(p.track) ? p.track.map((t) => ({ ...t })) : [],
    predecessor: Array.isArray(p.predecessor) ? [...p.predecessor]
      : (p.predecessor ? String(p.predecessor).split(',').filter(Boolean) : []),
    hours: Number(p.hours || 0),
    man_days: Number(p.man_days || 0),
    sort: Number(p.sort || 0),
    _new: !!p._new,
    _dirty: !!p._dirty,
    depth: 0,
    wbs: '',
  }))
  const byParent = new Map()
  for (const p of clones) {
    const key = p.parent_id || '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(p)
  }
  const out = []
  const walk = (key, depth, prefix) => {
    let i = 1
    for (const row of byParent.get(key) || []) {
      row.depth = depth
      row.wbs = prefix ? `${prefix}.${i}` : String(i)
      row.duration = workDays(row.start_date, row.end_date)
      out.push(row)
      walk(row.id, depth + 1, row.wbs)
      i += 1
    }
  }
  walk('__root__', 0, '')
  return out
}
function rebuild() { rows.value = buildTree(rows.value) }

// 甘特条：取清单中最早/最晚日期，按周对齐，最多显示 180 天
const dayWidth = 24
const dayInfo = (d) => {
  const day = d.getUTCDay()
  return {
    key: d.toISOString().slice(0, 10), day: d.getUTCDate(),
    month: d.getUTCMonth() + 1, year: d.getUTCFullYear(),
    weekend: day === 0 || day === 6,
  }
}
const ganttDays = computed(() => {
  const dates = rows.value.flatMap((r) => [r.start_date, r.end_date]).filter(Boolean).sort()
  if (!dates.length) {
    const now = new Date()
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return Array.from({ length: 30 }, (_, i) => dayInfo(new Date(first.getTime() + i * 86400000)))
  }
  const toDate = (s) => new Date(`${s}T00:00:00Z`)
  const start = toDate(dates[0])
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  const end = toDate(dates.at(-1))
  end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7)))
  const out = []
  let cur = start
  while (cur <= end && out.length < 180) {
    out.push(dayInfo(cur))
    cur = new Date(cur.getTime() + 86400000)
  }
  return out
})
const ganttIndex = computed(() => Object.fromEntries(ganttDays.value.map((d, i) => [d.key, i])))
const ganttWidth = computed(() => ganttDays.value.length * dayWidth)
const ganttMonths = computed(() => {
  const out = []
  for (const d of ganttDays.value) {
    const key = `${d.year}-${d.month}`
    const last = out.at(-1)
    if (last && last.key === key) last.days += 1
    else out.push({ key, label: `${d.year} 年 ${d.month} 月`, days: 1 })
  }
  return out
})
function ganttBar(row) {
  const indexOf = (date) => {
    if (!date) return undefined
    const hit = ganttIndex.value[date]
    if (hit !== undefined) return hit
    const first = ganttDays.value[0]?.key
    const last = ganttDays.value.at(-1)?.key
    if (date < first) return 0
    if (date > last) return ganttDays.value.length - 1
    return undefined
  }
  const s = indexOf(row.start_date)
  const e = indexOf(row.end_date)
  if (s === undefined || e === undefined) return null
  const from = Math.min(s, e)
  const to = Math.max(s, e)
  return { left: from * dayWidth + 2, width: (to - from + 1) * dayWidth - 4, days: row.duration || 0 }
}

async function loadCalendars() {
  try { calendars.value = await listCalendars() } catch (e) { ElMessage.error(e.message) }
}
const calendarYears = computed(() => calendars.value.map((c) => Number(c.year)).sort((a, b) => a - b))
const pad2 = (n) => String(n).padStart(2, '0')
const dateKey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`
function monthCells(m) {
  const y = Number(calendarYear.value)
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= total; d += 1) cells.push({ day: d, key: dateKey(y, m, d) })
  while (cells.length % 7) cells.push(null)
  return cells
}
const festivalNames = computed(() => ({ ...calendarData(calendarYear.value).names, ...govNames.value }))
const dateKind = (key) => {
  if (!key) return ''
  if (calendarForm.holidays.includes(key)) return 'holiday'
  if (calendarForm.workdays.includes(key)) return 'workday'
  return ''
}
const planDateCellClass = (value) => {
  const date = value instanceof Date ? value : value?.date
  if (!date) return ''
  const key = dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
  const cal = calendars.value.find((c) => Number(c.year) === date.getFullYear())
  if ((cal?.holidays || []).includes(key)) return 'plan-cal-holiday'
  if ((cal?.workdays || []).includes(key)) return 'plan-cal-workday'
  return ''
}
function toggleDate(cell) {
  if (!cell) return
  const key = cell.key
  const hi = calendarForm.holidays.indexOf(key)
  const wi = calendarForm.workdays.indexOf(key)
  if (hi >= 0) {
    calendarForm.holidays.splice(hi, 1)
    calendarForm.workdays.push(key)
  } else if (wi >= 0) {
    calendarForm.workdays.splice(wi, 1)
  } else {
    calendarForm.holidays.push(key)
  }
  calendarForm.holidays.sort()
  calendarForm.workdays.sort()
  calendarDirty.value = true
}
function syncCalendarForm() {
  const c = calendars.value.find((x) => Number(x.year) === Number(calendarYear.value))
  calendarForm.holidays = c?.holidays ? [...c.holidays] : []
  calendarForm.workdays = c?.workdays ? [...c.workdays] : []
  calendarForm.hours_per_day = Number(c?.hours_per_day ?? 8)
  calendarDirty.value = false
}
function selectCalendarYear(year) {
  calendarYear.value = Number(year)
  govNames.value = {}
  syncCalendarForm()
}
function openCalendar() {
  const current = new Date().getFullYear()
  selectCalendarYear(calendarYears.value.includes(current) ? current : (calendarYears.value.at(-1) ?? current))
  calendarDialog.value = true
}
async function saveCalendarSettings() {
  try {
    const saved = await saveCalendar(calendarYear.value, { ...calendarForm })
    const idx = calendars.value.findIndex((c) => Number(c.year) === Number(saved.year))
    if (idx >= 0) calendars.value.splice(idx, 1, saved)
    else calendars.value.push(saved)
    calendars.value.sort((a, b) => a - b)
    syncCalendarForm()
    ElMessage.success('日历设置已保存')
  } catch (e) { ElMessage.error(e.message) }
}
async function loadOnlineCalendar(year) {
  try {
    const data = await fetchGovCalendar(year)
    govNames.value = data.names || {}
    return { ...data, online: true }
  } catch (e) {
    govNames.value = {}
    ElMessage.warning(`政府网数据获取失败，已使用内置数据：${e.message}`)
    return { ...calendarData(year), online: false }
  }
}
async function addCalendarYear() {
  try {
    const suggestion = calendarYears.value.length ? Math.max(...calendarYears.value) + 1 : new Date().getFullYear()
    const { value } = await ElMessageBox.prompt('请输入要新增的年份', '新增年份', {
      inputValue: String(suggestion), inputPattern: /^20\d{2}$/,
      inputErrorMessage: '请输入 2000-2099 之间的年份',
    })
    const year = Number(value)
    if (calendarYears.value.includes(year)) throw new Error(`${year} 年已存在`)
    const data = await loadOnlineCalendar(year)
    const saved = await saveCalendar(year, { holidays: data.holidays, workdays: data.workdays, hours_per_day: 8 })
    calendars.value.push(saved)
    calendars.value.sort((a, b) => a - b)
    calendarYear.value = year
    syncCalendarForm()
    ElMessage.success(`已新增 ${year} 年，同步全年 ${data.holidays.length} 天假期、${data.workdays.length} 天调休（${data.online ? '中国政府网' : '内置数据'}）`)
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || String(e))
  }
}
async function syncHolidays() {
  const data = await loadOnlineCalendar(calendarYear.value)
  if (!data.holidays.length) return ElMessage.warning('该年份暂无假期数据，请在月份中手动标注')
  calendarForm.holidays = [...data.holidays]
  for (const d of data.holidays) {
    const wi = calendarForm.workdays.indexOf(d)
    if (wi >= 0) calendarForm.workdays.splice(wi, 1)
  }
  calendarDirty.value = true
  ElMessage.success(`已从${data.online ? '中国政府网' : '内置数据'}同步全年 ${data.holidays.length} 天假期，请保存生效`)
}
async function syncWorkdays() {
  const data = await loadOnlineCalendar(calendarYear.value)
  if (!data.workdays.length) {
    return ElMessage.warning(data.online ? '政府网该年通知未列出调休上班日' : '该年份暂无内置调休安排，请在月份中手动标注')
  }
  calendarForm.workdays = [...data.workdays]
  for (const d of data.workdays) {
    const hi = calendarForm.holidays.indexOf(d)
    if (hi >= 0) calendarForm.holidays.splice(hi, 1)
  }
  calendarDirty.value = true
  ElMessage.success(`已从${data.online ? '中国政府网' : '内置数据'}同步全年 ${data.workdays.length} 天调休，请保存生效`)
}

async function loadMeta() {
  try {
    const cfg = await http.get('/config/fields', { params: { scope: 1 } })
    projectMeta.value = cfg.projects || []
    statusOptions.value = cfg.dicts?.status || []
  } catch (e) { ElMessage.error(e.message) }
}
async function load(force = false) {
  if (!force && hasDirty.value) {
    const keep = await ElMessageBox.confirm('当前清单有未保存的修改，刷新后会丢失，确定继续？', '未保存修改', { type: 'warning' })
      .then(() => true).catch(() => false)
    if (!keep) return
  }
  loading.value = true
  try {
    const params = filter.project ? { project: filter.project } : {}
    plans.value = await listPlans(params)
    rows.value = buildTree(plans.value)
    selection.value = []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

function addDraftRows(count) {
  for (let i = 0; i < count; i += 1) {
    rows.value.push({
      id: `tmp-${tmpSeq.value++}`, project: filter.project, parent_id: null, parentReady: false,
      title: '', category: '', status: '未开始', owner: '', assistant1: '', assistant2: '',
      start_date: '', end_date: '', hours: 0, man_days: 0,
      sort: rows.value.length + i, note: '', predecessor: [], track: [], logs_count: 0,
      has_children: false, depth: 0, wbs: '', duration: 0, _new: true, _dirty: true,
    })
  }
  rebuild()
  editingCell.value = `${rows.value.at(-1)?.id}:parent_id`
}
async function requestAddRows() {
  if (!filter.project) return ElMessage.warning('请先选择项目，再批量新增行')
  try {
    const { value } = await ElMessageBox.prompt('可一次新增多行，随后直接在表格中填写', '批量新增行', {
      inputValue: '1', inputPattern: /^(?:[1-9]|[1-4]\d|50)$/,
      inputErrorMessage: '请输入 1-50 之间的整数',
    })
    addDraftRows(Number(value))
    ElMessage.success(`已新增 ${value} 行，点击单元格即可填写`)
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || String(e))
  }
}
function openCreate() {
  if (!filter.project) return ElMessage.warning('请先选择项目，再新增计划')
  addDraftRows(1)
  openCard(rows.value.at(-1))
}
function openCard(row) {
  if (!row || !auth.has('ISSUE_CREATE')) return
  cancelPendingEdit()
  editing.value = row
  Object.assign(form, {
    project: row.project || '', parent_id: row.parent_id || '',
    parentReady: row.parentReady !== false,
    title: row.title || '', category: row.category || '', status: row.status || '未开始', owner: row.owner || '',
    assistant1: row.assistant1 || '', assistant2: row.assistant2 || '',
    start_date: row.start_date || '', end_date: row.end_date || '',
    hours: Number(row.hours || 0), man_days: Number(row.man_days || 0),
    sort: Number(row.sort || 0), note: row.note || '',
    predecessor: Array.isArray(row.predecessor) ? [...row.predecessor] : [],
    track: Array.isArray(row.track) ? row.track.map((t) => ({ ...t })) : [],
  })
  applyCalc()
  dialog.value = true
}
function isEditing(row, field) { return editingCell.value === `${row.id}:${field}` }
let editTimer = null
let editSnapshot = null
const cloneVal = (v) => (Array.isArray(v) ? [...v] : v)
function cancelPendingEdit(keepSnapshot = false) {
  clearTimeout(editTimer)
  editTimer = null
  if (!keepSnapshot) editSnapshot = null
}
function startEdit(row, field) {
  if (!auth.has('ISSUE_CREATE')) return
  if (field === 'title' && row._new && !row.parentReady) {
    return ElMessage.warning('请先选择上级任务（一级任务请选择“一级任务（无上级）”）后再填写任务名称')
  }
  cancelPendingEdit()
  editSnapshot = { id: row.id, field, value: cloneVal(row[field]), dirty: !!row._dirty }
  const target = `${row.id}:${field}`
  editTimer = setTimeout(() => {
    editingCell.value = target
    editTimer = null
  }, 180)
}
function cancelCell(row, field) {
  if (!editSnapshot || editSnapshot.id !== row.id || editSnapshot.field !== field) return
  row[field] = cloneVal(editSnapshot.value)
  if (field === 'start_date' || field === 'end_date') row.duration = workDays(row.start_date, row.end_date)
  row._dirty = editSnapshot.dirty
  cancelPendingEdit()
  editingCell.value = ''
}
function onGlobalKeydown(e) {
  if (e.key !== 'Escape') return
  cancelPendingEdit(true)
  if (!editingCell.value) return
  const [id, field] = editingCell.value.split(':')
  const row = rows.value.find((r) => r.id === id)
  if (row) cancelCell(row, field)
  else editingCell.value = ''
}
function commitCell(row, field, value) {
  if (!auth.has('ISSUE_CREATE')) return
  cancelPendingEdit()
  if (field === 'predecessor') row.predecessor = Array.isArray(value) ? [...value] : []
  else row[field] = value
  if (field === 'start_date' || field === 'end_date') row.duration = workDays(row.start_date, row.end_date)
  row._dirty = true
  editingCell.value = ''
}
function validateDirty() {
  for (const r of rows.value.filter((x) => x._dirty)) {
    const at = r.wbs || '新增'
    if (!r.project) { ElMessage.warning(`第 ${at} 行未选择项目`); return false }
    if (!String(r.title || '').trim()) { ElMessage.warning(`第 ${at} 行任务名称必填`); return false }
    if (r.start_date && r.end_date && r.end_date < r.start_date) {
      ElMessage.warning(`第 ${at} 行完成时间不能早于开始时间`); return false
    }
  }
  return true
}
function payloadOf(r) {
  return {
    id: r.id, project: r.project,
    parent_id: r.parent_id === '__root__' ? null : (r.parent_id || null),
    title: String(r.title || '').trim(), category: r.category || '',
    status: r.status || '未开始', owner: r.owner || '',
    assistant1: r.assistant1 || '', assistant2: r.assistant2 || '',
    start_date: r.start_date || null, end_date: r.end_date || null,
    hours: Number(r.hours) || 0, man_days: Number(r.man_days) || 0,
    sort: Number(r.sort) || 0, note: r.note || '',
    predecessor: (r.predecessor || []).join(','),
    track: (r.track || []).map((t) => ({ date: t.date, text: t.text, by: t.by })),
  }
}
async function saveAll() {
  const dirty = rows.value.filter((r) => r._dirty)
  if (!dirty.length) return
  if (!validateDirty()) return
  saving.value = true
  try {
    await batchSavePlans(dirty.map(payloadOf))
    ElMessage.success(`已保存 ${dirty.length} 行`)
    dialog.value = false
    await load(true)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
async function saveCard() {
  if (!form.project) return ElMessage.warning('请选择项目')
  if (editing.value._new && !form.parentReady) {
    return ElMessage.warning('请先选择上级任务（一级任务请选择“一级任务（无上级）”）后再填写任务名称')
  }
  if (!form.title.trim()) return ElMessage.warning('任务名称必填')
  Object.assign(editing.value, {
    project: form.project,
    parent_id: form.parent_id === '__root__' ? null : (form.parent_id || null),
    parentReady: true,
    title: editing.value._new ? withParentPrefix(form.title, form.parent_id) : form.title.trim(),
    category: form.category || '', status: form.status || '未开始', owner: form.owner || '',
    assistant1: form.assistant1 || '', assistant2: form.assistant2 || '',
    start_date: form.start_date || null, end_date: form.end_date || null,
    hours: Number(form.hours) || 0, man_days: Number(form.man_days) || 0,
    sort: Number(form.sort) || 0, note: form.note || '',
    predecessor: [...form.predecessor],
    track: form.track.map((t) => ({ ...t })),
  })
  editing.value.duration = workDays(editing.value.start_date, editing.value.end_date)
  editing.value._dirty = true
  await saveAll()
}
async function remove(row) {
  if (row._new) {
    rows.value = rows.value.filter((r) => r !== row)
    selection.value = selection.value.filter((r) => r !== row)
    rebuild()
    return
  }
  try {
    await ElMessageBox.confirm(`删除「${row.title}」及其所有下级任务？`, '确认删除', { type: 'warning' })
    await deletePlan(row.id)
    ElMessage.success('已删除')
    await load(true)
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message)
  }
}
function onSelectionChange(value) { selection.value = value }
async function deleteSelected() {
  const targets = [...selection.value]
  if (!targets.length) return
  const saved = targets.filter((r) => !r._new)
  const remainingDirty = rows.value.filter((r) => r._dirty && !targets.includes(r))
  if (saved.length) {
    const message = remainingDirty.length
      ? `删除选中的 ${saved.length} 条任务会刷新清单，另有 ${remainingDirty.length} 行未保存修改将丢失，继续？`
      : `删除选中的 ${saved.length} 条任务及其所有下级？`
    const keep = await ElMessageBox.confirm(message, '批量删除', { type: 'warning' })
      .then(() => true).catch(() => false)
    if (!keep) return
  }
  try {
    for (const r of saved) await deletePlan(r.id)
    selection.value = []
    if (saved.length) {
      ElMessage.success(`已删除 ${saved.length} 条任务`)
      await load(true)
    } else {
      rows.value = rows.value.filter((r) => !targets.includes(r))
      rebuild()
      ElMessage.success(`已移除 ${targets.length} 行`)
    }
  } catch (e) {
    ElMessage.error(e.message)
  }
}
function clearEmptyDrafts() {
  const empties = rows.value.filter(isEmptyDraft)
  if (!empties.length) return ElMessage.info('没有可清理的空行')
  rows.value = rows.value.filter((r) => !empties.includes(r))
  selection.value = []
  rebuild()
  ElMessage.success(`已清理 ${empties.length} 行`)
}
// ---------- Excel 导出 ----------
async function doExport() {
  exportBusy.value = true
  try {
    const blob = await exportPlans({ project: filter.project })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `项目计划-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success('导出完成')
  } catch (e) {
    ElMessage.error(`导出失败：${e.message}`)
  } finally {
    exportBusy.value = false
  }
}

// ---------- Excel 导入：选文件 → 字段对照 → 导入 → 结果 ----------
async function openPlanImport() {
  planImportFile.value = null
  planImportHeaders.value = []
  Object.keys(planImportMapping).forEach((k) => delete planImportMapping[k])
  planImportResult.value = null
  planImportDialog.value = true
  if (!planImportFieldsList.value.length) planImportFieldsList.value = await fetchPlanImportFields()
}

async function pickPlanImportFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  planImportBusy.value = true
  planImportResult.value = null
  try {
    const d = await readPlanImportHeaders(file)
    planImportFile.value = file
    planImportHeaders.value = d.headers
    // 自动对照：表头同名优先，其次包含匹配
    for (const f of planImportFieldsList.value) {
      const exact = d.headers.find((h) => h.label === f.label)
      const guess = exact || d.headers.find((h) => h.label.includes(f.label) || f.label.includes(h.label))
      planImportMapping[f.key] = guess?.label || ''
    }
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    planImportBusy.value = false
  }
}

async function doPlanImport() {
  const missing = planImportFieldsList.value
    .filter((f) => ['project', 'title'].includes(f.key) && !planImportMapping[f.key])
  if (missing.length) ElMessage.warning(`必填列未映射：${missing.map((f) => f.label).join('、')}；将生成失败清单供修正`)
  planImportBusy.value = true
  try {
    planImportResult.value = await importPlans(planImportFile.value, { ...planImportMapping })
    await load(true)
  } catch (err) {
    const body = err.body || {}
    planImportResult.value = {
      message: err.message,
      imported: 0,
      failed: (body.failUrl || body.details?.failUrl) ? '全部' : 0,
      errors: body.details?.errors || body.errors || [],
      failUrl: body.failUrl || body.details?.failUrl || null,
    }
  } finally {
    planImportBusy.value = false
  }
}
onMounted(async () => {
  updateGridHeight()
  window.addEventListener('resize', updateGridHeight)
  window.addEventListener('keydown', onGlobalKeydown)
  await Promise.all([loadMeta(), loadCalendars()])
  load()
})
onUnmounted(() => {
  window.removeEventListener('resize', updateGridHeight)
  window.removeEventListener('keydown', onGlobalKeydown)
  stopResize()
})
</script>

<template>
  <div class="plan-page">
    <div class="topbar">
      <BackHome />
      <span class="brand">项目计划</span>
      <el-select v-model="filter.project" clearable filterable placeholder="全部项目" style="width:240px"
        @change="load()">
        <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
      </el-select>
      <div class="ops">
        <el-button v-if="auth.has('ISSUE_CREATE')" type="primary" size="small" @click="openCreate">新增计划</el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" size="small" @click="requestAddRows">批量新增行</el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" type="success" size="small" :disabled="!hasDirty" :loading="saving"
          @click="saveAll">保存更改<span v-if="hasDirty">（{{ rows.filter((r) => r._dirty).length }}）</span></el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" type="danger" size="small" :disabled="!selection.length"
          @click="deleteSelected">删除选中<span v-if="selection.length">（{{ selection.length }}）</span></el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" size="small" :disabled="!emptyDraftCount"
          @click="clearEmptyDrafts">清理空行<span v-if="emptyDraftCount">（{{ emptyDraftCount }}）</span></el-button>
        <el-button size="small" @click="showMore = !showMore">{{ showMore ? '精简列' : '更多列' }}</el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" size="small" @click="openCalendar">日历设置</el-button>
        <el-button v-if="auth.has('ISSUE_IMPORT')" size="small" @click="openPlanImport">导入 Excel</el-button>
        <el-button v-if="auth.has('DATA_EXPORT')" size="small" :loading="exportBusy"
          :disabled="exportBusy" @click="doExport">导出 Excel</el-button>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="num">{{ plans.length }}</div><div class="lbl">计划条目</div></div>
      <div class="kpi"><div class="num">{{ plans.filter((p) => !p.parent_id).length }}</div><div class="lbl">顶层计划</div></div>
      <div class="kpi"><div class="num">{{ totalHours }}</div><div class="lbl">总工时（h）</div></div>
      <div class="kpi"><div class="num">{{ totalManDays }}</div><div class="lbl">总人天</div></div>
    </div>

    <el-card shadow="never" v-loading="loading">
      <template #header>
        <div class="hd">
          <span>计划清单</span>
          <span class="hint">中间分割线可拖拽调整宽度 · 左表与甘特图可分别滚动 · 点击单元格行内编辑 · 双击整行打开卡片编辑</span>
        </div>
      </template>
      <div ref="planGrid" class="plan-grid" :class="{ dragging }" :style="{ height: `${gridHeight}px` }">
        <div class="list-pane" :style="{ width: `${leftPaneWidth}px` }">
          <el-table ref="leftTable" class="plan-table" :data="rows" row-key="id" border size="small"
            height="100%" :row-class-name="rowClass" @row-dblclick="openCard"
            @selection-change="onSelectionChange" @scroll="onLeftScroll">
            <el-table-column v-if="auth.has('ISSUE_CREATE')" type="selection" width="46" />
        <el-table-column label="WBS" width="86">
          <template #default="{ row }"><span class="wbs">{{ row.wbs }}</span></template>
        </el-table-column>
        <el-table-column label="分类" width="132">
          <template #default="{ row }">
            <el-select v-if="isEditing(row, 'category')" v-model="row.category" size="small" filterable allow-create
              default-first-option style="width:100%" @change="commitCell(row, 'category', row.category)"
              @visible-change="(v) => !v && commitCell(row, 'category', row.category)"
              @dblclick.stop="openCard(row)">
              <el-option v-for="c in categoryOptions" :key="c" :value="c" :label="c" />
            </el-select>
            <div v-else class="cell" @click="startEdit(row, 'category')" @dblclick.stop="openCard(row)">
              {{ row.category || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="上级任务" width="170">
          <template #default="{ row }">
            <el-select v-if="isEditing(row, 'parent_id')" :model-value="row.parent_id || '__root__'" size="small"
              style="width:100%" @change="commitParent(row, $event)">
              <el-option value="__root__" label="一级任务（无上级）" />
              <el-option v-for="opt in rowOptions" :key="opt.value" :value="opt.value" :label="opt.label"
                :disabled="opt.value === row.id" />
            </el-select>
            <div v-else class="cell" :class="{ tip: !row.parentReady }" @click="startEdit(row, 'parent_id')"
              @dblclick.stop="openCard(row)">{{ parentLabel(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="任务名称" min-width="250">
          <template #default="{ row }">
            <el-input v-if="isEditing(row, 'title')" v-model="row.title" size="small" maxlength="255"
              @blur="commitCell(row, 'title', row.title)" @keyup.enter="$event.target.blur()"
              @dblclick.stop="openCard(row)" />
            <div v-else class="cell title-cell" :class="{ disabled: row._new && !row.parentReady }"
              :style="{ paddingLeft: `${row.depth * 16}px` }" @click="startEdit(row, 'title')"
              @dblclick.stop="openCard(row)">{{ row.title || (row._new && !row.parentReady ? '请先选择上级任务' : '点击填写任务名称') }}</div>
          </template>
        </el-table-column>
        <el-table-column label="负责人" width="116">
          <template #default="{ row }">
            <el-input v-if="isEditing(row, 'owner')" v-model="row.owner" size="small"
              @blur="commitCell(row, 'owner', row.owner)" @keyup.enter="$event.target.blur()"
              @dblclick.stop="openCard(row)" />
            <div v-else class="cell" @click="startEdit(row, 'owner')" @dblclick.stop="openCard(row)">
              {{ row.owner || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="配合人1" width="116">
          <template #default="{ row }">
            <el-input v-if="isEditing(row, 'assistant1')" v-model="row.assistant1" size="small"
              @blur="commitCell(row, 'assistant1', row.assistant1)" @keyup.enter="$event.target.blur()"
              @dblclick.stop="openCard(row)" />
            <div v-else class="cell" @click="startEdit(row, 'assistant1')" @dblclick.stop="openCard(row)">
              {{ row.assistant1 || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="配合人2" width="116">
          <template #default="{ row }">
            <el-input v-if="isEditing(row, 'assistant2')" v-model="row.assistant2" size="small"
              @blur="commitCell(row, 'assistant2', row.assistant2)" @keyup.enter="$event.target.blur()"
              @dblclick.stop="openCard(row)" />
            <div v-else class="cell" @click="startEdit(row, 'assistant2')" @dblclick.stop="openCard(row)">
              {{ row.assistant2 || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="工期" width="116">
          <template #default="{ row }"><span class="duration">{{ row.duration }} 个工作日</span></template>
        </el-table-column>
        <el-table-column label="开始时间" width="130">
          <template #default="{ row }">
            <el-date-picker v-if="isEditing(row, 'start_date')" v-model="row.start_date" type="date"
              value-format="YYYY-MM-DD" size="small" style="width:100%" :disabled="!!row.has_children"
              :cell-class-name="planDateCellClass"
              @change="commitCell(row, 'start_date', row.start_date)" @dblclick.stop="openCard(row)" />
            <div v-else class="cell" :class="{ disabled: !!row.has_children }"
              @click="!row.has_children && startEdit(row, 'start_date')" @dblclick.stop="openCard(row)">
              {{ row.start_date || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="完成时间" width="130">
          <template #default="{ row }">
            <el-date-picker v-if="isEditing(row, 'end_date')" v-model="row.end_date" type="date"
              value-format="YYYY-MM-DD" size="small" style="width:100%" :disabled="!!row.has_children"
              :cell-class-name="planDateCellClass"
              @change="commitCell(row, 'end_date', row.end_date)" @dblclick.stop="openCard(row)" />
            <div v-else class="cell" :class="{ disabled: !!row.has_children }"
              @click="!row.has_children && startEdit(row, 'end_date')" @dblclick.stop="openCard(row)">
              {{ row.end_date || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="前置任务" width="180">
          <template #default="{ row }">
            <el-select v-if="isEditing(row, 'predecessor')" v-model="row.predecessor" multiple filterable size="small"
              style="width:100%" @change="commitCell(row, 'predecessor', row.predecessor)"
              @visible-change="(v) => !v && commitCell(row, 'predecessor', row.predecessor)"
              @dblclick.stop="openCard(row)">
              <el-option v-for="opt in rowOptions" :key="opt.value" :value="opt.value" :label="opt.label"
                :disabled="opt.value === row.id" />
            </el-select>
            <div v-else class="cell" @click="startEdit(row, 'predecessor')" @dblclick.stop="openCard(row)">
              {{ predecessorLabel(row) || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="106">
          <template #default="{ row }">
            <el-select v-if="isEditing(row, 'status')" v-model="row.status" size="small" style="width:100%"
              @change="commitCell(row, 'status', row.status)"
              @visible-change="(v) => !v && commitCell(row, 'status', row.status)">
              <el-option v-for="s in statusOptions" :key="s.value" :value="s.value" :label="s.label" />
            </el-select>
            <div v-else class="cell status-cell" @click="startEdit(row, 'status')" @dblclick.stop="openCard(row)">
              <el-tag size="small" :style="statusTagStyle(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="160">
          <template #default="{ row }">
            <el-input v-if="isEditing(row, 'note')" v-model="row.note" size="small"
              @blur="commitCell(row, 'note', row.note)" @keyup.enter="$event.target.blur()"
              @dblclick.stop="openCard(row)" />
            <div v-else class="cell" @click="startEdit(row, 'note')" @dblclick.stop="openCard(row)">
              {{ row.note || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="跟踪记录" width="180">
          <template #default="{ row }">
            <el-tooltip v-if="lastTrack(row)" placement="top" :show-after="200">
              <template #content>
                <div v-for="(t, i) in row.track" :key="i" style="margin:2px 0">
                  {{ t.date }} {{ t.text }}<span v-if="t.by">（{{ t.by }}）</span>
                </div>
              </template>
              <div class="track-cell">
                <span class="track-cell-date">{{ lastTrack(row).date }}</span>
                <span class="track-cell-text">{{ lastTrack(row).text }}</span>
              </div>
            </el-tooltip>
            <span v-else class="tip">—</span>
          </template>
        </el-table-column>
        <el-table-column label="修改日志" width="96">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openLogs(row)">日志{{ row.logs_count || 0 }}</el-button>
          </template>
        </el-table-column>
        <template v-if="showMore">
          <el-table-column label="项目" width="130">
            <template #default="{ row }">
              <el-select v-if="isEditing(row, 'project')" v-model="row.project" size="small" filterable
                style="width:100%" @change="commitCell(row, 'project', row.project)" @dblclick.stop="openCard(row)">
                <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
              </el-select>
              <div v-else class="cell" @click="startEdit(row, 'project')" @dblclick.stop="openCard(row)">
                {{ row.project || '—' }}
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="hours" label="工时" width="90" />
          <el-table-column prop="man_days" label="人天" width="90" />
        </template>
        <el-table-column label="操作" width="176" fixed="right">
          <template #default="{ row }">
            <el-button v-if="auth.has('ISSUE_CREATE')" type="primary" size="small" @click="openCard(row)">卡片编辑</el-button>
            <el-button v-if="auth.has('ISSUE_CREATE')" type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
          </el-table>
        </div>
        <div class="pane-divider" title="拖动调整宽度，双击重置" @pointerdown="startResize" @dblclick="resetResize">
          <span class="divider-grip" />
        </div>
        <div class="gantt-pane">
          <div ref="ganttScroll" class="gantt-scroll" @scroll="onGanttScroll">
            <div class="gantt-head" :style="{ width: `${ganttWidth}px` }">
              <div class="gantt-months">
                <div v-for="m in ganttMonths" :key="m.key" class="gantt-month"
                  :style="{ width: `${m.days * dayWidth}px` }">{{ m.label }}</div>
              </div>
              <div class="gantt-days">
                <div v-for="d in ganttDays" :key="d.key" class="gantt-day" :class="{ weekend: d.weekend }"
                  :style="{ width: `${dayWidth}px` }">{{ d.day }}</div>
              </div>
            </div>
            <div class="gantt-body">
              <div v-for="row in rows" :key="row.id" class="gantt-row"
                :class="{ 'dirty-row': row._dirty, 'selected-row': selection.some((s) => s.id === row.id),
                  'editing-row': editingRowId === row.id }"
                :style="{ width: `${ganttWidth}px` }" @dblclick="openCard(row)">
                <div class="gantt-track" :style="{ width: `${ganttWidth}px` }">
                  <div v-for="d in ganttDays" :key="d.key" class="gantt-grid-cell" :class="{ weekend: d.weekend }"
                    :style="{ width: `${dayWidth}px` }" />
                  <div v-if="ganttBar(row)" class="gantt-bar" :class="{ summary: !!row.has_children }"
                    :style="{ left: `${ganttBar(row).left}px`, width: `${ganttBar(row).width}px` }"
                    :title="`${row.title}：${row.start_date || ''} ~ ${row.end_date || ''}（${ganttBar(row).days} 个工作日）`" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="!rows.length" class="empty">暂无计划，点击「批量新增行」或「导入 Excel」开始编写</div>
    </el-card>

    <el-dialog v-model="dialog" :title="editing?._new ? '新增任务卡片' : '任务卡片编辑'" width="780px" top="4vh"
      class="card-dialog">
      <div class="card-grid">
        <el-card shadow="never" class="edit-card">
          <template #header><span class="card-title">基础信息</span></template>
          <el-form :model="form" label-width="86px" size="small">
            <el-form-item label="项目" required>
              <el-select v-model="form.project" placeholder="请选择项目" style="width:100%">
                <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
              </el-select>
            </el-form-item>
            <el-form-item label="WBS">
              <el-input :model-value="editing?.wbs || '保存后生成'" disabled />
            </el-form-item>
            <el-form-item label="分类">
              <el-select v-model="form.category" filterable allow-create default-first-option placeholder="选择或输入"
                style="width:100%">
                <el-option v-for="c in categoryOptions" :key="c" :value="c" :label="c" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width:100%">
                <el-option v-for="s in statusOptions" :key="s.value" :value="s.value" :label="s.label" />
              </el-select>
            </el-form-item>
            <el-form-item label="上级任务" required>
              <el-select v-model="form.parent_id" placeholder="请先选择上级任务" style="width:100%">
                <el-option value="__root__" label="一级任务（无上级）" />
                <el-option v-for="p in parentOptions" :key="p.id" :value="p.id" :label="`${p.wbs} ${p.title}`" />
              </el-select>
              <div v-if="editing?._new" class="hint">非一级任务请先选择上级；选择后任务名称会自动带上直接上级名称</div>
            </el-form-item>
            <el-form-item label="任务名称" required>
              <el-input v-model="form.title" maxlength="255" :disabled="editing?._new && !form.parentReady"
                :placeholder="editing?._new && !form.parentReady ? '请先选择上级任务' : '请输入任务名称'" />
            </el-form-item>
            <el-form-item label="负责人"><el-input v-model="form.owner" /></el-form-item>
            <el-form-item label="配合人1"><el-input v-model="form.assistant1" /></el-form-item>
            <el-form-item label="配合人2"><el-input v-model="form.assistant2" /></el-form-item>
            <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" style="width:100%" /></el-form-item>
          </el-form>
        </el-card>
        <el-card shadow="never" class="edit-card">
          <template #header><span class="card-title">时间与工作量</span></template>
          <el-form :model="form" label-width="86px" size="small">
            <el-form-item label="开始时间">
              <el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%"
                :disabled="rolledUp" :cell-class-name="planDateCellClass" />
            </el-form-item>
            <el-form-item label="完成时间">
              <el-date-picker v-model="form.end_date" type="date" value-format="YYYY-MM-DD" style="width:100%"
                :disabled="rolledUp" :cell-class-name="planDateCellClass" />
            </el-form-item>
            <el-form-item label="工期">
              <el-input :model-value="`${workDays(form.start_date, form.end_date)} 个工作日`" disabled />
            </el-form-item>
            <el-form-item label="工时">
              <el-input-number v-model="form.hours" :min="0" :step="1" style="width:100%"
                :disabled="rolledUp || autoCalc" />
            </el-form-item>
            <el-form-item label="人天">
              <el-input-number v-model="form.man_days" :min="0" :step="0.5" style="width:100%"
                :disabled="rolledUp || autoCalc" />
            </el-form-item>
            <div v-if="rolledUp" class="hint">该任务有下级，时间/工时/人天由下级自动汇总。</div>
            <div v-else-if="autoCalc" class="hint">已按日历根据起止日期自动计算工时与人天。</div>
          </el-form>
        </el-card>
        <el-card shadow="never" class="edit-card span-2">
          <template #header><span class="card-title">依赖与备注</span></template>
          <el-form :model="form" label-width="86px" size="small">
            <el-form-item label="前置任务">
              <el-select v-model="form.predecessor" multiple filterable style="width:100%" placeholder="可多选">
                <el-option v-for="opt in rowOptions" :key="opt.value" :value="opt.value" :label="opt.label"
                  :disabled="opt.value === editing?.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="3" /></el-form-item>
            <el-form-item label="跟踪记录"><TrackRecords v-model="form.track" /></el-form-item>
          </el-form>
        </el-card>
      </div>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" type="primary" :loading="saving" @click="saveCard">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="logDialog" :title="logTitle" width="760px">
      <el-table :data="logList" size="small" border max-height="480">
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.changed_at) }}</template>
        </el-table-column>
        <el-table-column prop="field_label" label="字段" width="110" />
        <el-table-column prop="before_value" label="原值" show-overflow-tooltip />
        <el-table-column prop="after_value" label="新值" show-overflow-tooltip />
        <el-table-column prop="changed_by" label="操作人" width="110" />
      </el-table>
    </el-dialog>

    <el-dialog v-model="calendarDialog" title="日历设置" width="1100px" top="3vh" class="calendar-dialog">
      <div class="calendar-layout">
        <aside class="calendar-years">
          <el-button type="primary" size="small" style="width:100%" @click="addCalendarYear">新增年份</el-button>
          <div class="year-list">
            <div v-for="y in calendarYears" :key="y" class="year-item"
              :class="{ active: Number(calendarYear) === y }" @click="selectCalendarYear(y)">
              {{ y }} 年
            </div>
            <div v-if="!calendarYears.length" class="year-empty">暂无年份，点击上方新增</div>
          </div>
        </aside>
        <section v-if="calendarYears.length" class="calendar-main">
          <div class="calendar-toolbar">
            <el-button size="small" type="primary" plain @click="syncHolidays">同步假期</el-button>
            <el-button size="small" type="success" plain @click="syncWorkdays">同步调休</el-button>
            <span class="hint">每日工时</span>
            <el-input-number v-model="calendarForm.hours_per_day" :min="0.5" :max="24" :step="0.5"
              size="small" style="width:110px" @change="calendarDirty = true" />
            <span class="hint">数据源：中国政府网公开通知（失败时回退内置数据）；同步按整年生效，点击日期可手动调整</span>
          </div>
          <div class="months-grid">
            <div v-for="m in calendarMonths" :key="m" class="month-card">
              <div class="month-title">{{ calendarYear }} 年 {{ m }} 月</div>
              <div class="calendar-grid">
                <div v-for="w in weekNames" :key="w" class="week-head">{{ w }}</div>
                <div v-for="(cell, i) in monthCells(m)" :key="i" class="day-cell" :class="dateKind(cell && cell.key)"
                  @click="toggleDate(cell)">
                  <template v-if="cell">
                    <span class="day-num">{{ cell.day }}</span>
                    <span v-if="festivalNames[cell.key]" class="festival">{{ festivalNames[cell.key] }}</span>
                    <span v-if="dateKind(cell.key)" class="day-badge" :class="dateKind(cell.key)">
                      {{ dateKind(cell.key) === 'holiday' ? '休' : '班' }}
                    </span>
                  </template>
                </div>
              </div>
            </div>
          </div>
          <div class="calendar-legend">
            <span><i class="dot holiday" />假期</span>
            <span><i class="dot workday" />调休上班</span>
            <span class="hint">内置安排可整年同步，个别日期可在月份中继续调整</span>
          </div>
        </section>
        <section v-else class="calendar-main calendar-empty">请先新增一个年份</section>
      </div>
      <template #footer>
        <el-button @click="calendarDialog = false">关闭</el-button>
        <el-button v-if="auth.has('ISSUE_CREATE') && calendarYears.length" type="primary"
          :disabled="!calendarDirty" @click="saveCalendarSettings">保存</el-button>
      </template>
    </el-dialog>

    <!-- Excel 导入 -->
    <el-dialog v-model="planImportDialog" title="导入项目计划" width="720px" destroy-on-close>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
        title="先选择文件并确认字段对照，再导入；成功/失败行数会分别统计，失败记录可下载清单修改后重新导入" />
      <div class="toolbar">
        <input ref="planXlsxInput" type="file" accept=".xlsx,.xls" style="display:none" @change="pickPlanImportFile" />
        <el-button :loading="planImportBusy" @click="$refs.planXlsxInput.click()">选择 Excel 文件</el-button>
        <span v-if="planImportFile" class="tip">{{ planImportFile.name }}（{{ planImportHeaders.length }} 列）</span>
      </div>
      <template v-if="planImportHeaders.length">
        <div class="imp-title">字段对照（必填项需指定来源列）</div>
        <el-table :data="planImportFieldsList" size="small" border max-height="320">
          <el-table-column label="系统字段" width="150">
            <template #default="{ row }">
              <span>{{ row.label }}</span>
              <span v-if="['project','title'].includes(row.key)" style="color:#e6a23c"> *</span>
            </template>
          </el-table-column>
          <el-table-column label="Excel 列">
            <template #default="{ row }">
              <el-select v-model="planImportMapping[row.key]" clearable filterable placeholder="不导入"
                style="width:100%">
                <el-option v-for="h in planImportHeaders" :key="h.col" :value="h.label"
                  :label="`${h.label}（第${h.col}列）`" />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
        <div class="tip" style="margin-top:8px">
          带「编号（导入用）」与「上级编号」列可导入父子层级；导出的 Excel 可直接重新导入。
        </div>
        <div style="margin-top:12px; text-align:right">
          <el-button type="primary" :loading="planImportBusy" @click="doPlanImport">开始导入</el-button>
        </div>
      </template>
      <template v-if="planImportResult">
        <el-alert :type="planImportResult.failed ? 'warning' : 'success'" :closable="false" show-icon
          style="margin-top:14px"
          :title="planImportResult.message || `导入完成：成功 ${planImportResult.imported} 条，失败 ${planImportResult.failed} 条`" />
        <div v-if="planImportResult.message" class="tip" style="margin-top:4px">
          成功 {{ planImportResult.imported }} 条，失败 {{ planImportResult.failed }} 条
        </div>
        <div v-if="planImportResult.errors?.length" class="imp-errors">
          <div v-for="(e, i) in planImportResult.errors.slice(0, 10)" :key="i">
            第 {{ e.row }} 行 · {{ e.field }}：{{ e.message }}
          </div>
          <div v-if="planImportResult.errors.length > 10" class="tip">仅显示前 10 条，完整信息见失败清单</div>
        </div>
        <div v-if="planImportResult.failUrl" style="margin-top:10px">
          <el-button tag="a" :href="planImportResult.failUrl" download type="primary" plain>下载失败记录 Excel</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.plan-page { padding: 12px; }
.topbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.brand { font-size: 18px; font-weight: 700; }
.ops { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px; }
.kpi { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 14px 16px; }
.kpi .num { font-size: 26px; font-weight: 700; color: var(--el-color-primary); }
.kpi .lbl { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; }
.hd { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.hint { font-size: 12px; color: var(--el-text-color-secondary); }
.empty { color: var(--el-text-color-disabled); font-size: 13px; padding: 16px 0; }
.cell { min-height: 24px; padding: 2px 4px; cursor: text; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell.disabled { cursor: not-allowed; color: var(--el-text-color-placeholder); }
.title-cell { font-weight: 500; }
.wbs { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
.duration { font-size: 12px; color: var(--el-text-color-regular); }
.track-cell { display: flex; flex-direction: column; line-height: 1.4; overflow: hidden; }
.track-cell-date { color: var(--el-color-primary); font-weight: 600; font-size: 12px; }
.track-cell-text { color: var(--el-text-color-primary); font-size: 12px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.tip { font-size: 12px; color: var(--el-text-color-secondary); }
.imp-title { font-weight: 600; margin: 12px 0 8px; }
.imp-errors { margin-top: 8px; max-height: 120px; overflow: auto; font-size: 12px;
  color: var(--el-color-danger); line-height: 1.7; }
.status-cell { display: flex; align-items: center; }
:deep(.plan-table .el-table__fixed-right td.el-table__cell) {
  background-color: var(--el-bg-color) !important;
}
:deep(.plan-table tr.dirty-row > td.el-table__cell) {
  background: color-mix(in srgb, var(--el-color-warning) 16%, var(--el-bg-color)) !important;
}
:deep(.plan-table tr.selected-row > td.el-table__cell) {
  background: color-mix(in srgb, var(--el-color-primary) 13%, var(--el-bg-color)) !important;
}
:deep(.plan-table tr.editing-row > td.el-table__cell),
:deep(.plan-table .el-table__fixed-right tr.editing-row > td.el-table__cell) {
  background: color-mix(in srgb, var(--el-color-primary) 22%, var(--el-bg-color)) !important;
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
:deep(.plan-table tr.editing-row .el-input__wrapper),
:deep(.plan-table tr.editing-row .el-select__wrapper),
:deep(.plan-table tr.editing-row .el-date-editor) {
  background-color: var(--el-fill-color-blank) !important;
}
.plan-grid { display: flex; min-height: 360px; }
.plan-grid.dragging { user-select: none; cursor: col-resize; }
.list-pane { flex: 0 0 auto; min-width: 0; min-height: 0; }
.pane-divider { flex: 0 0 10px; position: relative; cursor: col-resize; display: flex;
  align-items: center; justify-content: center; }
.pane-divider::before { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 2px;
  background: var(--el-border-color); border-radius: 2px; }
.pane-divider:hover::before, .plan-grid.dragging .pane-divider::before { background: var(--el-color-primary); }
.divider-grip { width: 4px; height: 28px; border-radius: 2px; background: var(--el-border-color);
  position: relative; z-index: 1; }
.pane-divider:hover .divider-grip, .plan-grid.dragging .divider-grip { background: var(--el-color-primary); }
.gantt-pane { flex: 1; min-width: 300px; min-height: 0; border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px; overflow: hidden; }
.plan-grid :deep(.plan-table) { height: 100%; }
.plan-grid :deep(.plan-table th.el-table__cell) { height: 42px; padding: 0; }
.plan-grid :deep(.plan-table td.el-table__cell) { height: 34px; padding: 0; }
.plan-grid :deep(.plan-table .el-table__row) { height: 34px; }
.gantt-scroll { width: 100%; height: 100%; overflow: auto; }
.gantt-head { position: sticky; top: 0; z-index: 2; height: 42px; background: var(--el-bg-color); }
.gantt-months { display: flex; height: 22px; }
.gantt-month { flex: none; line-height: 22px; text-align: center; font-size: 11px;
  border-right: 1px solid var(--el-border-color); }
.gantt-days { display: flex; height: 20px; border-top: 1px solid var(--el-border-color-lighter); }
.gantt-day { flex: none; line-height: 20px; text-align: center; font-size: 10px;
  color: var(--el-text-color-secondary); border-right: 1px solid var(--el-border-color-lighter); }
.gantt-day.weekend, .gantt-grid-cell.weekend { background: var(--el-fill-color-light); }
.gantt-row { height: 34px; border-top: 1px solid var(--el-border-color-lighter); cursor: default; }
.gantt-row.dirty-row { background: color-mix(in srgb, var(--el-color-warning) 16%, var(--el-bg-color)); }
.gantt-row.selected-row { background: color-mix(in srgb, var(--el-color-primary) 13%, var(--el-bg-color)); }
.gantt-row.editing-row {
  background: color-mix(in srgb, var(--el-color-primary) 22%, var(--el-bg-color));
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
.gantt-track { position: relative; display: flex; height: 33px; }
.gantt-grid-cell { flex: none; height: 100%; border-right: 1px solid var(--el-border-color-lighter); }
.gantt-bar { position: absolute; top: 10px; height: 12px; border-radius: 6px;
  background: var(--el-color-primary); opacity: 0.86; }
.gantt-bar.summary { background: var(--el-color-success); }
.card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.edit-card .el-form-item { margin-bottom: 12px; }
.span-2 { grid-column: 1 / -1; }
.card-title { font-weight: 600; }
.calendar-layout { display: flex; gap: 16px; height: 70vh; }
.calendar-years { width: 150px; flex-shrink: 0; border-right: 1px solid var(--el-border-color-lighter); padding-right: 12px; }
.year-list { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.year-item { padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 14px; }
.year-item:hover { background: var(--el-fill-color-light); }
.year-item.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 600; }
.year-empty { font-size: 12px; color: var(--el-text-color-secondary); padding: 10px 4px; }
.calendar-main { flex: 1; min-width: 0; overflow-y: auto; padding-right: 4px; }
.calendar-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.months-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.month-card { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 8px; }
.month-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.week-head { text-align: center; font-size: 11px; color: var(--el-text-color-secondary); padding: 2px 0; }
.day-cell { position: relative; height: 34px; border: 1px solid var(--el-border-color-lighter); border-radius: 4px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;
  font-size: 12px; background: var(--el-bg-color); overflow: hidden; }
.day-cell:hover { border-color: var(--el-color-primary); }
.day-cell.holiday { background: #fef0f0; border-color: #fbc4c4; color: #f56c6c; }
.day-cell.workday { background: #f0f9eb; border-color: #c2e7b0; color: #67c23a; }
.festival { font-size: 9px; line-height: 1; color: #f56c6c; }
.day-badge { position: absolute; top: 0; right: 0; font-size: 9px; line-height: 1.2; padding: 0 2px;
  border-radius: 0 4px 0 4px; color: #fff; }
.day-badge.holiday { background: #f56c6c; }
.day-badge.workday { background: #409eff; }
.calendar-legend { display: flex; align-items: center; gap: 14px; margin-top: 12px; font-size: 12px; }
.calendar-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.calendar-legend .dot.holiday { background: #f56c6c; }
.calendar-legend .dot.workday { background: #409eff; }
.calendar-empty { display: flex; align-items: center; justify-content: center; color: var(--el-text-color-secondary); }
:global(.plan-cal-holiday .el-date-table-cell__text) {
  position: relative;
  color: #f56c6c !important;
  background: #fef0f0;
  border-radius: 4px;
}
:global(.plan-cal-holiday .el-date-table-cell__text::after) {
  content: '休';
  position: absolute;
  top: -5px;
  right: -3px;
  font-size: 9px;
  line-height: 1;
  padding: 0 1px;
  border-radius: 2px;
  color: #fff;
  background: #f56c6c;
}
:global(.plan-cal-workday .el-date-table-cell__text) {
  position: relative;
  color: #67c23a !important;
  background: #f0f9eb;
  border-radius: 4px;
}
:global(.plan-cal-workday .el-date-table-cell__text::after) {
  content: '班';
  position: absolute;
  top: -5px;
  right: -3px;
  font-size: 9px;
  line-height: 1;
  padding: 0 1px;
  border-radius: 2px;
  color: #fff;
  background: #409eff;
}
</style>
