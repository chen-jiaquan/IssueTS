<script setup>
// 项目计划：Excel 式清单（批量新增 / 行内编辑 / 双击卡片编辑）+ 甘特条 + 工作日历
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
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
const personnelMeta = ref([])
const personKeys = ['owner', 'assistant1', 'assistant2']
const personOptions = computed(() => [...new Set((personnelMeta.value || []).map((p) => p.name).filter(Boolean))])
function personOptionsWith(value) {
  const name = String(value || '').trim()
  if (!name) return personOptions.value
  return personOptions.value.includes(name) ? personOptions.value : [name, ...personOptions.value]
}
const plans = ref([])
const rows = ref([])
const selection = ref([])
const leftTable = ref(null)
const ganttScroll = ref(null)
const planGrid = ref(null)
const gridHeight = ref(520)
const leftPaneWidth = ref(760)
const ganttVisible = ref(true)
watch(ganttVisible, () => nextTick(relayoutTable))
// 参考问题跟踪：'' 不锁定 / 'header' 仅锁定表头 / 'both' 表头+前 3 个数据列固定（偏好存本地）
const lockMode = ref(localStorage.getItem('plan_lock_mode') ?? 'both')
const leftFixed = computed(() => (lockMode.value === 'both' ? 'left' : undefined))
const FIXED_DATA_COLS = 3
const colFixed = (i) => (lockMode.value === 'both' && i < FIXED_DATA_COLS ? 'left' : undefined)
function setPlanLockMode(val) {
  localStorage.setItem('plan_lock_mode', val ?? '')
  nextTick(() => { bindColumnDrag(); relayoutTable() })
}
const dragging = ref(false)
const loading = ref(false)
const saving = ref(false)
// 列配置：顺序/显隐/筛选/排序统一由此驱动
const COL_DEFS = [
  { key: 'project_name', label: '项目名称', width: 130, field: 'project_name' },
  { key: 'wbs', label: 'WBS', width: 86, field: 'wbs', sortable: true },
  { key: 'category', label: '分类', width: 132, field: 'category' },
  { key: 'parent_id', label: '上级任务', width: 170, field: 'parent_id' },
  { key: 'title', label: '任务名称', minWidth: 250, field: 'title' },
  { key: 'owner', label: '负责人', width: 116, field: 'owner' },
  { key: 'assistant1', label: '配合人1', width: 116, field: 'assistant1' },
  { key: 'assistant2', label: '配合人2', width: 116, field: 'assistant2' },
  { key: 'duration', label: '工期', width: 116, field: 'duration' },
  { key: 'start_date', label: '开始时间', width: 130, field: 'start_date' },
  { key: 'end_date', label: '完成时间', width: 130, field: 'end_date' },
  { key: 'predecessor', label: '前置任务', width: 180, field: 'predecessor' },
  { key: 'status', label: '状态', width: 106, field: 'status' },
  { key: 'note', label: '备注', minWidth: 160, field: 'note' },
  { key: 'track', label: '跟踪记录', width: 180, field: 'track' },
  { key: 'seq_no', label: '序号', width: 96, field: 'seq_no' },
  { key: 'logs', label: '修改日志', width: 96, field: 'logs' },
  { key: 'project', label: '项目', width: 130, field: 'project' },
  { key: 'hours', label: '工时', width: 90, field: 'hours' },
  { key: 'man_days', label: '人天', width: 90, field: 'man_days' },
]
const columns = ref(COL_DEFS.map((c) => ({ ...c, visible: !['project', 'hours', 'man_days'].includes(c.key) })))
// 列顺序按用户隔离存本地：拖拽只影响本人，换账号不会串顺序；“恢复默认排序”回到系统预置顺序
const columnOrderKey = computed(() => `plan_column_order:${auth.user?.id || 'anon'}`)
const columnOrder = ref([])
function readColumnOrder() {
  try { return JSON.parse(localStorage.getItem(columnOrderKey.value) || '[]') } catch { return [] }
}
function saveColumnOrder(order) {
  columnOrder.value = order
  localStorage.setItem(columnOrderKey.value, JSON.stringify(order))
}
function applyColumnOrder() {
  const order = columnOrder.value
  if (!order.length) return
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i }
  columns.value.sort((a, b) => rank(a.key) - rank(b.key))
}
function loadUserColumnOrder() {
  columnOrder.value = readColumnOrder()
  const visible = new Map(columns.value.map((c) => [c.key, c.visible]))
  columns.value = COL_DEFS.map((c) => ({ ...c, visible: visible.get(c.key) ?? c.visible }))
  applyColumnOrder()
  nextTick(bindColumnDrag)
}
function resetColumnOrder() {
  const visible = new Map(columns.value.map((c) => [c.key, c.visible]))
  columns.value = COL_DEFS.map((c) => ({ ...c, visible: visible.get(c.key) ?? c.visible }))
  saveColumnOrder([])
  localStorage.removeItem(columnOrderKey.value)
  nextTick(bindColumnDrag)
  ElMessage.success('列顺序已恢复默认')
}
loadUserColumnOrder()
watch(() => auth.user?.id, loadUserColumnOrder)
const visibleColumns = computed(() => columns.value.filter((c) => c.visible))
const columnSettingDialog = ref(false)
const shownColumnKeys = computed({
  get: () => columns.value.filter((c) => c.visible).map((c) => c.key),
  set: (keys) => columns.value.forEach((c) => { c.visible = keys.includes(c.key) }),
})
const dragColKey = ref('')
function projectName(code) {
  const meta = projectMeta.value.find((p) => p.code === code)
  return meta?.name || code || ''
}
function fieldValue(row, key) {
  switch (key) {
    case 'project_name': return projectName(row.project)
    case 'title': return shortTaskTitle(row.title)
    case 'parent_id': return parentLabel(row)
    case 'predecessor': return predecessorLabel(row)
    case 'status': return statusLabel(row.status)
    case 'track': return lastTrack(row)?.date || ''
    case 'duration': return `${row.duration || 0} 个工作日`
    case 'logs': return `日志${row.logs_count || 0}`
    default: return row[key] ?? ''
  }
}
const columnFilters = computed(() => {
  const out = {}
  for (const col of columns.value) {
    const set = new Set()
    for (const row of rows.value) {
      const v = fieldValue(row, col.field)
      if (v) set.add(String(v))
    }
    out[col.key] = [...set].slice(0, 200).sort().map((v) => ({ text: v, value: v }))
  }
  return out
})
const activeFilters = reactive({})
const titleKeyword = ref('')
// 0 表示全部展开；N 表示只显示到第 N 级 WBS
const expandLevel = ref(0)
const maxDepth = computed(() => Math.max(1, ...rows.value.map((r) => Number(r.depth || 0) + 1)))
function isLevelHidden(row) { return expandLevel.value > 0 && Number(row.depth || 0) + 1 > expandLevel.value }
function isCollapsedParent(row) {
  return expandLevel.value > 0 && !!row.has_children && Number(row.depth || 0) + 1 === expandLevel.value
}
function expandNextLevel(row) { expandLevel.value = Math.min(maxDepth.value, Number(row.depth || 0) + 2) }
function onExpandLevelChange() {
  selection.value = selection.value.filter((r) => !isLevelHidden(r))
}
function rowMatchesFilters(row) {
  for (const [key, values] of Object.entries(activeFilters)) {
    if (!Array.isArray(values) || !values.length) continue
    const col = columns.value.find((c) => c.key === key)
    if (!col) continue
    const cell = String(fieldValue(row, col.field)).toLowerCase()
    if (key === 'title') {
      if (!values.some((v) => cell.includes(String(v).toLowerCase()))) return false
    } else if (!values.some((v) => cell === String(v))) return false
  }
  return true
}
const filteredRows = computed(() => rows.value.filter((r) => rowMatchesFilters(r) && !isLevelHidden(r)))
function applyTitleFilter() {
  const keyword = String(titleKeyword.value || '').trim()
  if (keyword) activeFilters.title = [keyword]
  else delete activeFilters.title
}
function noopFilter() { return true }
function onFilterChange(filters) {
  for (const key of Object.keys(activeFilters)) if (key !== 'title') delete activeFilters[key]
  const columnsById = new Map()
  for (const th of document.querySelectorAll('.plan-table .el-table__header-wrapper th')) {
    const id = [...th.classList].find((c) => c.startsWith('el-table_') && c.includes('_column_'))
    const key = [...th.classList].find((c) => c.startsWith('col-'))?.slice(4)
    if (id && key) columnsById.set(id, key)
  }
  for (const [id, values] of Object.entries(filters || {})) {
    const key = columnsById.get(id)
    if (key && Array.isArray(values) && values.length) activeFilters[key] = values
  }
}
function clearTableFilters() {
  titleKeyword.value = ''
  for (const key of Object.keys(activeFilters)) delete activeFilters[key]
  nextTick(() => leftTable.value?.clearFilter?.())
}
function compareWbs(a, b) {
  const pa = String(a.wbs || '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b.wbs || '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}
function reorderColumn(target) {
  const from = columns.value.findIndex((c) => c.key === dragColKey.value)
  const to = columns.value.findIndex((c) => c.key === target)
  if (from < 0 || to < 0 || from === to) return
  const [moved] = columns.value.splice(from, 1)
  columns.value.splice(to, 0, moved)
  saveColumnOrder(columns.value.map((c) => c.key))
  dragColKey.value = ''
  nextTick(bindColumnDrag)
}
const columnResize = ref(null)
function onColumnResizeMove(e) {
  const state = columnResize.value
  if (!state) return
  const col = columns.value.find((c) => c.key === state.key)
  if (!col) return
  col.width = Math.max(state.minWidth, Math.min(1200, state.startWidth + e.clientX - state.startX))
  relayoutTable()
}
function stopColumnResize() {
  if (!columnResize.value) return
  columnResize.value = null
  window.removeEventListener('pointermove', onColumnResizeMove)
  window.removeEventListener('pointerup', stopColumnResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}
function startColumnResize(e, key) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const th = e.currentTarget?.closest('th')
  const startWidth = th?.getBoundingClientRect().width || 120
  const col = columns.value.find((c) => c.key === key)
  if (!col) return
  columnResize.value = {
    key,
    startX: e.clientX,
    startWidth,
    minWidth: Math.max(64, Number(col.minWidth) || 0),
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onColumnResizeMove)
  window.addEventListener('pointerup', stopColumnResize)
}
function resetColumnWidth(key) {
  const def = COL_DEFS.find((c) => c.key === key)
  const col = columns.value.find((c) => c.key === key)
  if (!def || !col) return
  col.width = def.width || def.minWidth || 160
  relayoutTable()
}
function bindColumnResize(th, key) {
  let handle = th.querySelector('.col-resize-handle')
  if (!handle) {
    handle = document.createElement('div')
    handle.className = 'col-resize-handle'
    th.appendChild(handle)
  }
  handle.dataset.col = key
  handle.draggable = false
  handle.title = '拖拽调整列宽，双击恢复默认宽度'
  handle.onpointerdown = (e) => startColumnResize(e, key)
  handle.ondblclick = (e) => { e.stopPropagation(); resetColumnWidth(key) }
}
function bindColumnDrag() {
  nextTick(() => {
    const ths = [...(leftTable.value?.$el?.querySelectorAll('.el-table__header-wrapper th') || [])]
      .filter((th) => !th.closest('.el-table__fixed'))
    ths.forEach((th) => {
      const match = th.className.match(/col-([a-z0-9_]+)/)
      if (!match) return
      const key = match[1]
      th.draggable = true
      th.title = '拖拽调整列顺序'
      th.ondragstart = (e) => {
        if (e.target?.classList?.contains('col-resize-handle')) return e.preventDefault()
        dragColKey.value = key
        e.dataTransfer.effectAllowed = 'move'
      }
      th.ondragover = (e) => e.preventDefault()
      th.ondrop = (e) => { e.preventDefault(); reorderColumn(key) }
      bindColumnResize(th, key)
    })
  })
}
watch(columns, bindColumnDrag, { deep: true })
const editingCell = ref('')
const titleDrafts = reactive({})
const dialog = ref(false)
const editing = ref(null)
const tmpSeq = ref(1)
const form = reactive({
  project: '', parent_id: '', seq_no: '', parentReady: true, title: '', category: '', status: '未开始',
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
const PARENT_SEP = '｜'
function parentName(parentId) {
  const parent = parentId ? rowById.value[parentId] : null
  return parent ? String(parent.title || '').trim() : ''
}
function withParentPrefix(title, parentId) {
  const prefix = parentName(parentId)
  const clean = String(title || '').trim()
  if (!prefix) return clean
  const full = `${prefix}${NAME_SEP}`
  if (clean.startsWith(full) || clean === full.trimEnd()) return clean
  return `${full}${clean}`
}
function shortTaskTitle(title) {
  const parts = String(title || '').split(NAME_SEP).map((x) => x.trim()).filter(Boolean)
  return parts.at(-1) || String(title || '').trim()
}
function pathLabel(title) {
  return String(title || '').split(NAME_SEP).map((x) => x.trim()).filter(Boolean).join(PARENT_SEP)
}
function optionLabel(row) {
  return pathLabel(row.title)
}
function hasTaskName(row) {
  const title = String(row.title || '').trim()
  return !!title && title !== withParentPrefix('', row.parent_id).trim()
}
const parentLabel = (row) => {
  if (!row.parent_id) return ''
  const parent = rowById.value[row.parent_id]
  return parent ? optionLabel(parent) : row.parent_id
}
function setRowParent(row, value) {
  row.parent_id = value === '__root__' ? null : value
  row.parentReady = true
  row._dirty = true
}
function commitParent(row, value) {
  setRowParent(row, value)
  editingCell.value = `${row.id}:title`
}
const rowOptions = computed(() => rows.value.map((r) => ({ value: r.id, label: optionLabel(r) })))
const predecessorLabel = (row) => (row.predecessor || []).map((id) => {
  const r = rowById.value[id]
  return r ? optionLabel(r) : id
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
const isEmptyDraft = (r) => !!r._new && !hasTaskName(r) && !r.category && !r.owner
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
  if (row.has_children) classes.push('summary-row')
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
watch(() => form.parent_id, (val) => { form.parentReady = !!val })

function buildTree(source) {
  const clones = source.map((p) => ({
    ...p,
    category: p.category || '',
    status: p.status || '未开始',
    seq_no: p.seq_no || '',
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
  const place = (row, depth, generated) => {
    row.depth = depth
    row.wbs = generated
    row._seqStale = String(row.seq_no || '') !== generated
    row.seq_no = generated
    row.duration = workDays(row.start_date, row.end_date)
    out.push(row)
    walk(row.id, depth + 1, generated, row.project)
  }
  const walk = (key, depth, prefix, project) => {
    let i = 1
    for (const row of (byParent.get(key) || []).filter((r) => r.project === project)) {
      place(row, depth, prefix ? `${prefix}.${i}` : String(i))
      i += 1
    }
  }
  // WBS 完全由层级位置生成：按项目隔离，每个项目根节点都从 1 开始
  const projectOrder = [...new Set(clones.map((r) => r.project || ''))]
  for (const project of projectOrder) {
    const roots = (byParent.get('__root__') || []).filter((r) => r.project === project)
    let i = 1
    for (const row of roots) {
      place(row, 0, String(i))
      i += 1
    }
  }
  const rollup = (row) => {
    const kids = byParent.get(row.id) || []
    for (const kid of kids) rollup(kid)
    if (!kids.length) return
    row.has_children = true
    const dates = kids.flatMap((k) => [k.start_date, k.end_date]).filter(Boolean).sort()
    row.start_date = dates[0] || ''
    row.end_date = dates.at(-1) || ''
    row.duration = workDays(row.start_date, row.end_date)
    row.hours = kids.reduce((sum, k) => sum + Number(k.hours || 0), 0)
    row.man_days = kids.reduce((sum, k) => sum + Number(k.man_days || 0), 0)
  }
  for (const row of byParent.get('__root__') || []) rollup(row)
  // 默认按项目 + WBS 组合从小到大排列（WBS 为点分数值自然序）
  out.sort((a, b) => {
    const pa = String(a.project || '')
    const pb = String(b.project || '')
    if (pa !== pb) return pa.localeCompare(pb, 'zh-CN', { numeric: true })
    return compareWbs(a, b)
  })
  return out
}
function rebuild() { rows.value = buildTree(rows.value) }

// 甘特条：取清单中最早/最晚日期，按日、周、月三种粒度展示
const ganttScale = ref('day')
const cellWidth = computed(() => ({ day: 24, week: 56, month: 90 })[ganttScale.value] || 24)
function ganttCell(d, scale) {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  if (scale === 'day') {
    return {
      key: d.toISOString().slice(0, 10), label: String(day),
      groupKey: `${y}-${m + 1}`, groupLabel: `${y} 年 ${m + 1} 月`,
      start: new Date(Date.UTC(y, m, day)), end: new Date(Date.UTC(y, m, day)),
      weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
    }
  }
  if (scale === 'week') {
    const start = new Date(Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7)))
    const end = new Date(start.getTime() + 6 * 86400000)
    const weekNo = Math.floor((start - new Date(Date.UTC(start.getUTCFullYear(), 0, 1))) / 604800000) + 1
    return {
      key: start.toISOString().slice(0, 10), label: `第${weekNo}周`,
      groupKey: `${start.getUTCFullYear()}-${start.getUTCMonth() + 1}`,
      groupLabel: `${start.getUTCFullYear()} 年 ${start.getUTCMonth() + 1} 月`,
      start, end, weekend: false,
    }
  }
  const start = new Date(Date.UTC(y, m, 1))
  const end = new Date(Date.UTC(y, m + 1, 0))
  return {
    key: `${y}-${m + 1}`, label: `${m + 1} 月`, groupKey: String(y), groupLabel: `${y} 年`,
    start, end, weekend: false,
  }
}
const ganttDays = computed(() => {
  const dates = filteredRows.value.flatMap((r) => [r.start_date, r.end_date]).filter(Boolean).sort()
  let start
  let end
  if (!dates.length) {
    const now = new Date()
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
  } else {
    start = new Date(`${dates[0]}T00:00:00Z`)
    end = new Date(`${dates.at(-1)}T00:00:00Z`)
  }
  const scale = ganttScale.value
  if (scale === 'month') {
    start = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
    end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0))
  } else {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
    end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7)))
  }
  const step = scale === 'month'
    ? (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    : (d) => new Date(d.getTime() + (scale === 'week' ? 7 : 1) * 86400000)
  const max = scale === 'month' ? 120 : scale === 'week' ? 520 : 3660
  const out = []
  let cur = start
  while (cur <= end && out.length < max) {
    out.push(ganttCell(cur, scale))
    cur = step(cur)
  }
  return out
})
const ganttIndex = computed(() => Object.fromEntries(ganttDays.value.map((d, i) => [d.key, i])))
const ganttWidth = computed(() => ganttDays.value.length * cellWidth.value)
const ganttMonths = computed(() => {
  const out = []
  for (const d of ganttDays.value) {
    const last = out.at(-1)
    if (last && last.key === d.groupKey) last.days += 1
    else out.push({ key: d.groupKey, label: d.groupLabel, days: 1 })
  }
  return out
})
function ganttBar(row) {
  const indexOf = (date) => {
    if (!date) return undefined
    const hit = ganttIndex.value[date]
    if (hit !== undefined) return hit
    const t = new Date(`${date}T00:00:00Z`).getTime()
    const idx = ganttDays.value.findIndex((c) => t >= c.start.getTime() && t <= c.end.getTime())
    if (idx >= 0) return idx
    const first = ganttDays.value[0]
    const last = ganttDays.value.at(-1)
    if (!first || !last) return undefined
    if (t < first.start.getTime()) return 0
    if (t > last.end.getTime()) return ganttDays.value.length - 1
    return undefined
  }
  const s = indexOf(row.start_date)
  const e = indexOf(row.end_date)
  if (s === undefined || e === undefined) return null
  const from = Math.min(s, e)
  const to = Math.max(s, e)
  return { left: from * cellWidth.value + 2, width: (to - from + 1) * cellWidth.value - 4, days: row.duration || 0 }
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
    personnelMeta.value = cfg.personnel || []
  } catch (e) { ElMessage.error(e.message) }
}
async function onProjectChange() {
  clearTableFilters()
  await load()
}
// 历史数据的序号可能跨项目串号；按新规则生成后静默回写，避免导出/再次读取时又出现旧序号
async function normalizeSeqNo() {
  if (!auth.has('ISSUE_CREATE')) return
  const stale = rows.value.filter((r) => r._seqStale)
  if (!stale.length) return
  try {
    await batchSavePlans(stale.map(payloadOf))
    stale.forEach((r) => { r._seqStale = false })
  } catch {
    // 回写失败只影响持久化，表格仍按新规则展示 WBS
  }
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
    await normalizeSeqNo()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

const addRowsDialog = ref(false)
const addRowsIntent = ref('batch')
const addRowsMode = ref('sibling')
const addRowsCount = ref(1)
const addRowsAnchorId = ref('')
const addRowsAnchor = computed(() => rows.value.find((r) => r.id === addRowsAnchorId.value) || null)
const addRowsDialogTitle = computed(() => addRowsIntent.value === 'card' ? '新增计划' : '批量新增行')
function selectedAnchor() {
  const selectedIds = new Set(selection.value.map((r) => r.id))
  let index = -1
  rows.value.forEach((r, i) => { if (selectedIds.has(r.id)) index = i })
  return { anchor: index >= 0 ? rows.value[index] : null, index }
}
function subtreeLastIndex(anchor) {
  const ids = new Set([anchor.id])
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows.value) {
      if (row.parent_id && ids.has(row.parent_id) && !ids.has(row.id)) {
        ids.add(row.id)
        grew = true
      }
    }
  }
  let last = -1
  rows.value.forEach((row, i) => { if (ids.has(row.id)) last = i })
  return last
}
function moveRowAfterParent(row, parentId) {
  const at = rows.value.findIndex((r) => r.id === row.id)
  if (at >= 0) rows.value.splice(at, 1)
  const parent = parentId ? rows.value.find((r) => r.id === parentId) : null
  if (parent) rows.value.splice(subtreeLastIndex(parent) + 1, 0, row)
  else rows.value.push(row)
}
function setRowSeq(row, generated) {
  if (String(row.seq_no || '') !== generated) {
    row.seq_no = generated
    if (!row._new) row._dirty = true
  }
  row.wbs = generated
}
// 按项目重排整个项目的 WBS：根节点 1..n，子节点继承上级 WBS 后各自从 1 开始
function renumberProject(project, sourceRows = rows.value) {
  const inProject = sourceRows.filter((r) => (r.project || '') === (project || ''))
  const walk = (parentId, prefix) => {
    const group = inProject.filter((r) => (r.parent_id || null) === parentId)
    group.forEach((row, i) => {
      const generated = prefix ? `${prefix}.${i + 1}` : String(i + 1)
      setRowSeq(row, generated)
      walk(row.id, generated)
    })
  }
  walk(null, '')
}
function renumberAffected(items) {
  const projects = [...new Set(items.map((i) => i.project || ''))]
  for (const project of projects) renumberProject(project)
  rebuild()
}
function addDraftRows(count, anchor = null, mode = 'sibling') {
  const at = anchor ? subtreeLastIndex(anchor) : -1
  const parentId = mode === 'child' && anchor ? anchor.id : (anchor?.parent_id || null)
  const drafts = []
  for (let i = 0; i < count; i += 1) {
    drafts.push({
      id: `tmp-${tmpSeq.value++}`, project: anchor?.project || filter.project,
      parent_id: parentId, seq_no: '', parentReady: true,
      title: '', category: anchor?.category || '', status: '未开始',
      owner: '', assistant1: '', assistant2: '',
      start_date: '', end_date: '', hours: 0, man_days: 0,
      sort: (at >= 0 ? at + 1 : rows.value.length) + i, note: '', predecessor: [], track: [], logs_count: 0,
      has_children: false, depth: 0, wbs: '', duration: 0, _new: true, _dirty: true,
    })
  }
  if (at >= 0) rows.value.splice(at + 1, 0, ...drafts)
  else rows.value.push(...drafts)
  renumberProject(anchor?.project || filter.project)
  rebuild()
  const first = rows.value.find((r) => r.id === drafts[0].id)
  editingCell.value = `${first?.id}:title`
  return drafts
}
function openAddRowsDialog(intent) {
  const { anchor } = selectedAnchor()
  const label = intent === 'card' ? '新增计划' : '批量新增行'
  if (!filter.project && !anchor?.project) return ElMessage.warning(`请先选择项目，再${label}`)
  addRowsIntent.value = intent
  addRowsAnchorId.value = anchor?.id || ''
  addRowsMode.value = 'sibling'
  addRowsCount.value = 1
  addRowsDialog.value = true
}
function requestAddRows() { openAddRowsDialog('batch') }
function confirmAddRows() {
  const anchor = addRowsAnchor.value
  const count = addRowsIntent.value === 'card' ? 1 : Number(addRowsCount.value)
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    return ElMessage.warning('请输入 1-50 之间的整数')
  }
  const mode = anchor ? addRowsMode.value : 'sibling'
  const drafts = addDraftRows(count, anchor, mode)
  addRowsDialog.value = false
  if (addRowsIntent.value === 'card') {
    editingCell.value = ''
    openCard(rows.value.find((r) => r.id === drafts[0].id))
  } else {
    ElMessage.success(`已新增 ${count} 行，${mode === 'child' ? '下级' : '同级'}WBS 与序号已重排`)
  }
}
function openCreate() { openAddRowsDialog('card') }
function openCard(row) {
  if (!row || !auth.has('ISSUE_CREATE')) return
  cancelPendingEdit()
  editing.value = row
  Object.assign(form, {
    project: row.project || '', parent_id: row.parent_id || '', seq_no: row.seq_no || '',
    parentReady: row.parentReady !== false,
    title: shortTaskTitle(row.title), category: row.category || '', status: row.status || '未开始', owner: row.owner || '',
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
function applyPredecessorReference(row) {
  if (!row._new) return false
  const hasPred = Array.isArray(row.predecessor) && row.predecessor.length > 0
  if (hasPred && row.start_date) return false
  const index = rows.value.findIndex((r) => r.id === row.id)
  if (index <= 0) return false
  let prev = null
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = rows.value[i]
    if (candidate.id === row.id) continue
    if (candidate.project === row.project && candidate.end_date && String(candidate.title || '').trim()) {
      prev = candidate
      break
    }
  }
  if (!prev) return false
  if (!hasPred) row.predecessor = [prev.id]
  if (!row.start_date) row.start_date = prev.end_date
  const m = calcMetrics(row.start_date, row.end_date)
  row.hours = m.hours
  row.man_days = m.manDays
  row.duration = workDays(row.start_date, row.end_date)
  return true
}
function commitTitleEdit(row) {
  const draft = String(titleDrafts[row.id] ?? '').trim()
  delete titleDrafts[row.id]
  commitCell(row, 'title', withParentPrefix(draft, row.parent_id))
  if (applyPredecessorReference(row)) rebuild()
}
function cancelCell(row, field) {
  if (!editSnapshot || editSnapshot.id !== row.id || editSnapshot.field !== field) return
  row[field] = cloneVal(editSnapshot.value)
  row._dirty = editSnapshot.dirty
  cancelPendingEdit()
  editingCell.value = ''
  if (field === 'title') delete titleDrafts[row.id]
  if (field === 'start_date' || field === 'end_date') rebuild()
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
  row._dirty = true
  editingCell.value = ''
  if (field === 'start_date' || field === 'end_date') rebuild()
}
// 序号按点分层级：1.2 的上级为 1；返回 undefined 表示未找到上级，保留原上级
function inferParentBySeq(seq, selfId) {
  const parts = String(seq || '').trim().split('.').filter(Boolean)
  if (parts.length <= 1) return null
  const parentSeq = parts.slice(0, -1).join('.')
  const parent = rows.value.find((r) => String(r.seq_no || '').trim() === parentSeq && r.id !== selfId)
  if (!parent) {
    ElMessage.warning(`未找到序号 ${parentSeq} 的任务，仍按当前上级生成 WBS`)
    return undefined
  }
  return parent.id
}
function commitSeq(row) {
  const parentId = inferParentBySeq(row.seq_no, row.id)
  if (parentId !== undefined) row.parent_id = parentId
  row.parentReady = true
  commitCell(row, 'seq_no', row.seq_no)
  renumberProject(row.project)
  rebuild()
}
function onFormSeqChange() {
  const parentId = inferParentBySeq(form.seq_no, editing.value?.id)
  if (parentId !== undefined) form.parent_id = parentId
}
function validateDirty() {
  for (const r of rows.value.filter((x) => x._dirty)) {
    const at = r.wbs || '新增'
    if (!r.project) { ElMessage.warning(`第 ${at} 行未选择项目`); return false }
    if (!hasTaskName(r)) { ElMessage.warning(`第 ${at} 行任务名称必填`); return false }
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
    seq_no: String(r.seq_no || '').trim(),
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
// ---------- 批量修改（参考问题清单） ----------
const batchDialog = ref(false)
const batchSaving = ref(false)
const batchField = ref('status')
const batchValue = ref('')
const batchFields = [
  { key: 'category', label: '分类' },
  { key: 'status', label: '状态' },
  { key: 'owner', label: '负责人' },
  { key: 'assistant1', label: '配合人1' },
  { key: 'assistant2', label: '配合人2' },
  { key: 'start_date', label: '开始时间' },
  { key: 'end_date', label: '完成时间' },
  { key: 'note', label: '备注' },
]
const batchOptions = computed(() => {
  switch (batchField.value) {
    case 'category': return categoryOptions.value
    case 'status': return statusOptions.value.map((s) => s.value)
    case 'owner': case 'assistant1': case 'assistant2': return personOptions.value
    default: return []
  }
})
const batchIsDate = computed(() => ['start_date', 'end_date'].includes(batchField.value))
function onBatchFieldChange() { batchValue.value = '' }
async function applyBatch() {
  const targets = selection.value.filter((r) => !r._new)
  if (!targets.length) return ElMessage.warning('请先勾选已保存的计划行')
  if (batchValue.value === '' || batchValue.value == null) return ElMessage.warning('请选择或填写目标值')
  batchSaving.value = true
  try {
    await batchSavePlans(targets.map((r) => payloadOf({ ...r, [batchField.value]: batchValue.value })))
    ElMessage.success(`已批量更新 ${targets.length} 行（逐行留痕）`)
    batchDialog.value = false
    batchValue.value = ''
    selection.value = []
    await load(true)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    batchSaving.value = false
  }
}
async function saveCard() {
  if (!form.project) return ElMessage.warning('请选择项目')
  if (editing.value._new && !form.parentReady) {
    return ElMessage.warning('请先选择上级任务（一级任务请选择“一级任务（无上级）”）后再填写任务名称')
  }
  if (!String(form.title || '').trim()) return ElMessage.warning('任务名称必填')
  const oldParentId = editing.value.parent_id || null
  const parentId = form.parent_id === '__root__' ? null : (form.parent_id || null)
  Object.assign(editing.value, {
    project: form.project,
    parent_id: parentId,
    seq_no: String(form.seq_no || '').trim(),
    parentReady: true,
    title: withParentPrefix(form.title.trim(), parentId),
    category: form.category || '', status: form.status || '未开始', owner: form.owner || '',
    assistant1: form.assistant1 || '', assistant2: form.assistant2 || '',
    start_date: form.start_date || null, end_date: form.end_date || null,
    hours: Number(form.hours) || 0, man_days: Number(form.man_days) || 0,
    sort: Number(form.sort) || 0, note: form.note || '',
    predecessor: [...form.predecessor],
    track: form.track.map((t) => ({ ...t })),
  })
  editing.value._dirty = true
  if (editing.value._new) {
    if (oldParentId !== parentId) moveRowAfterParent(editing.value, parentId)
    renumberProject(editing.value.project)
    applyPredecessorReference(editing.value)
    rebuild()
    const saved = rows.value.find((r) => r.id === editing.value?.id)
    if (saved) saved._dirty = true
  } else {
    editing.value.duration = workDays(editing.value.start_date, editing.value.end_date)
  }
  await saveAll()
}
async function remove(row) {
  const affected = [{ parent_id: row.parent_id || null, project: row.project }]
  if (row._new) {
    rows.value = rows.value.filter((r) => r !== row)
    selection.value = selection.value.filter((r) => r !== row)
    renumberAffected(affected)
    return
  }
  try {
    await ElMessageBox.confirm(`删除「${shortTaskTitle(row.title)}」及其所有下级任务？`, '确认删除', { type: 'warning' })
    await deletePlan(row.id)
    ElMessage.success('已删除')
    await load(true)
    renumberAffected(affected)
    await saveAll()
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
    // 删除父任务会级联删除所有下级，只对选中的“顶层”任务发起删除，避免下级已被删时报不存在
    const savedIds = new Set(saved.map((r) => r.id))
    const roots = saved.filter((r) => {
      let pid = r.parent_id
      while (pid) {
        if (savedIds.has(pid)) return false
        pid = rowById.value[pid]?.parent_id
      }
      return true
    })
    const affected = (saved.length ? roots : targets).map((r) => ({
      parent_id: r.parent_id || null, project: r.project,
    }))
    for (const r of roots) await deletePlan(r.id)
    selection.value = []
    if (saved.length) {
      ElMessage.success(`已删除 ${saved.length} 条任务`)
      await load(true)
      renumberAffected(affected)
      await saveAll()
    } else {
      rows.value = rows.value.filter((r) => !targets.includes(r))
      renumberAffected(affected)
      ElMessage.success(`已移除 ${targets.length} 行，WBS 与序号已更新`)
    }
  } catch (e) {
    ElMessage.error(e.message)
  }
}
function clearEmptyDrafts() {
  const empties = rows.value.filter(isEmptyDraft)
  if (!empties.length) return ElMessage.info('没有可清理的空行')
  const affected = empties.map((r) => ({ parent_id: r.parent_id || null, project: r.project }))
  rows.value = rows.value.filter((r) => !empties.includes(r))
  selection.value = []
  renumberAffected(affected)
  ElMessage.success(`已清理 ${empties.length} 行，WBS 与序号已更新`)
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
  await load()
  bindColumnDrag()
})
onUnmounted(() => {
  window.removeEventListener('resize', updateGridHeight)
  window.removeEventListener('keydown', onGlobalKeydown)
  stopResize()
  stopColumnResize()
})
</script>

<template>
  <div class="plan-page">
    <div class="topbar">
      <BackHome />
      <span class="brand">项目计划</span>
      <el-select v-model="filter.project" clearable filterable placeholder="全部项目" style="width:240px"
        @change="onProjectChange">
        <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
      </el-select>
      <span class="ops-label">WBS 层级</span>
      <el-select v-model="expandLevel" size="small" style="width:132px" @change="onExpandLevelChange">
        <el-option :value="0" label="全部展开" />
        <el-option v-for="n in maxDepth" :key="n" :value="n" :label="`展开至 ${n} 级`" />
      </el-select>
      <span class="ops-label">任务名称</span>
      <el-input v-model="titleKeyword" size="small" clearable placeholder="模糊筛选" style="width:180px"
        @input="applyTitleFilter" @clear="applyTitleFilter" />
      <div class="ops">
        <el-button v-if="auth.has('ISSUE_CREATE')" type="primary" size="small" @click="openCreate">新增计划</el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" size="small" @click="requestAddRows">批量新增行</el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" size="small" :disabled="!selection.length" @click="batchDialog = true">
          批量修改（{{ selection.length }}）
        </el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" type="success" size="small" :disabled="!hasDirty" :loading="saving"
          @click="saveAll">保存更改<span v-if="hasDirty">（{{ rows.filter((r) => r._dirty).length }}）</span></el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" type="danger" size="small" :disabled="!selection.length"
          @click="deleteSelected">删除选中<span v-if="selection.length">（{{ selection.length }}）</span></el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" size="small" :disabled="!emptyDraftCount"
          @click="clearEmptyDrafts">清理空行<span v-if="emptyDraftCount">（{{ emptyDraftCount }}）</span></el-button>
        <el-button size="small" @click="columnSettingDialog = true">列设置</el-button>
        <el-button v-if="columnOrder.length" size="small" @click="resetColumnOrder">恢复默认排序</el-button>
        <el-tooltip content="锁定行列：固定表头、多选与前 3 个数据列" placement="bottom">
          <el-select v-model="lockMode" size="small" style="width:120px" @change="setPlanLockMode">
            <el-option label="不锁定" value="" />
            <el-option label="锁定表头" value="header" />
            <el-option label="锁定行列" value="both" />
          </el-select>
        </el-tooltip>
        <template v-if="ganttVisible">
          <span class="ops-label">甘特图</span>
          <el-radio-group v-model="ganttScale" size="small" aria-label="甘特图展示粒度">
            <el-radio-button value="day">日</el-radio-button>
            <el-radio-button value="week">周</el-radio-button>
            <el-radio-button value="month">月</el-radio-button>
          </el-radio-group>
        </template>
        <el-button size="small" @click="ganttVisible = !ganttVisible">
          {{ ganttVisible ? '隐藏甘特图' : '显示甘特图' }}
        </el-button>
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
          <span class="hint">表头拖拽调整列顺序和列宽 · 双击列宽手柄恢复默认宽度 · 中间分割线可拖拽调整宽度 · 左表与甘特图可分别滚动</span>
        </div>
      </template>
      <div ref="planGrid" class="plan-grid" :class="{ dragging }" :style="{ height: `${gridHeight}px` }">
        <div class="list-pane" :style="ganttVisible ? { width: `${leftPaneWidth}px` } : { flex: 1, width: '100%' }">
          <el-table ref="leftTable" class="plan-table" :data="filteredRows" row-key="id" border stripe size="small"
            height="100%" :row-class-name="rowClass" @row-dblclick="openCard"
            @selection-change="onSelectionChange" @scroll="onLeftScroll" @filter-change="onFilterChange">
            <el-table-column v-if="auth.has('ISSUE_CREATE')" type="selection" width="46" :fixed="leftFixed" />
        <el-table-column v-for="(col, i) in visibleColumns" :key="col.key" :prop="col.field" :label="col.label"
          :width="col.width" :min-width="col.minWidth" :class-name="`col-${col.key}`" :fixed="colFixed(i)"
          :sortable="col.sortable || false" :sort-method="col.sortable ? compareWbs : undefined"
          :filters="columnFilters[col.key]" :filter-method="noopFilter" filter-placement="bottom-end">
          <template #default="{ row }">
            <el-input v-if="col.key === 'seq_no' && isEditing(row, 'seq_no')" v-model="row.seq_no" size="small"
              placeholder="如 1.2" @blur="commitSeq(row)" @keyup.enter="$event.target.blur()"
              @dblclick.stop="openCard(row)" />
            <div v-else-if="col.key === 'seq_no'" class="cell wbs" @click="startEdit(row, 'seq_no')"
              @dblclick.stop="openCard(row)">{{ row.seq_no || '—' }}</div>

            <span v-else-if="col.key === 'project_name'" class="cell">{{ projectName(row.project) }}</span>

            <span v-else-if="col.key === 'wbs'" class="wbs">
              <span v-if="isCollapsedParent(row)" class="wbs-expand" title="展开下一级"
                @click.stop="expandNextLevel(row)">▸</span>{{ row.wbs }}
            </span>

            <el-select v-else-if="col.key === 'category' && isEditing(row, 'category')" v-model="row.category"
              size="small" filterable allow-create default-first-option style="width:100%"
              @change="commitCell(row, 'category', row.category)"
              @visible-change="(v) => !v && commitCell(row, 'category', row.category)"
              @dblclick.stop="openCard(row)">
              <el-option v-for="c in categoryOptions" :key="c" :value="c" :label="c" />
            </el-select>
            <div v-else-if="col.key === 'category'" class="cell" @click="startEdit(row, 'category')"
              @dblclick.stop="openCard(row)">{{ row.category || '—' }}</div>

            <el-select v-else-if="col.key === 'parent_id' && isEditing(row, 'parent_id')"
              :model-value="row.parent_id || '__root__'" size="small" style="width:100%"
              @change="commitParent(row, $event)">
              <el-option value="__root__" label="一级任务（无上级）" />
              <el-option v-for="opt in rowOptions" :key="opt.value" :value="opt.value" :label="opt.label"
                :disabled="opt.value === row.id" />
            </el-select>
            <div v-else-if="col.key === 'parent_id'" class="cell" :class="{ tip: !row.parentReady }"
              @click="startEdit(row, 'parent_id')" @dblclick.stop="openCard(row)">{{ parentLabel(row) }}</div>

            <el-input v-else-if="col.key === 'title' && isEditing(row, 'title')"
              :model-value="titleDrafts[row.id] ?? shortTaskTitle(row.title)" size="small" maxlength="255"
              @input="titleDrafts[row.id] = $event" @blur="commitTitleEdit(row)"
              @keyup.enter="$event.target.blur()" @dblclick.stop="openCard(row)" />
            <div v-else-if="col.key === 'title'" class="cell title-cell"
              :class="{ disabled: row._new && !row.parentReady }"
              :style="{ paddingLeft: `${row.depth * 16}px` }" @click="startEdit(row, 'title')"
              @dblclick.stop="openCard(row)">{{ shortTaskTitle(row.title) || (row._new && !row.parentReady ? '请先选择上级任务' : '点击填写任务名称') }}</div>

            <el-select v-else-if="personKeys.includes(col.key) && isEditing(row, col.key)"
              :model-value="row[col.key] || ''" size="small" filterable clearable style="width:100%"
              @change="commitCell(row, col.key, $event || '')"
              @visible-change="(v) => !v && cancelCell(row, col.key)" @dblclick.stop="openCard(row)">
              <el-option v-for="name in personOptionsWith(row[col.key])" :key="name" :value="name" :label="name" />
            </el-select>
            <div v-else-if="personKeys.includes(col.key)" class="cell"
              @click="startEdit(row, col.key)" @dblclick.stop="openCard(row)">{{ row[col.key] || '—' }}</div>

            <span v-else-if="col.key === 'duration'" class="duration">{{ row.duration }} 个工作日</span>

            <el-date-picker v-else-if="['start_date', 'end_date'].includes(col.key) && isEditing(row, col.key)"
              v-model="row[col.key]" type="date" value-format="YYYY-MM-DD" size="small" style="width:100%"
              :disabled="!!row.has_children" :cell-class-name="planDateCellClass"
              @change="commitCell(row, col.key, row[col.key])" @dblclick.stop="openCard(row)" />
            <div v-else-if="['start_date', 'end_date'].includes(col.key)" class="cell"
              :class="{ disabled: !!row.has_children }"
              @click="!row.has_children && startEdit(row, col.key)" @dblclick.stop="openCard(row)">
              {{ row[col.key] || '—' }}
            </div>

            <el-select v-else-if="col.key === 'predecessor' && isEditing(row, 'predecessor')"
              v-model="row.predecessor" multiple filterable size="small" style="width:100%"
              @change="commitCell(row, 'predecessor', row.predecessor)"
              @visible-change="(v) => !v && commitCell(row, 'predecessor', row.predecessor)"
              @dblclick.stop="openCard(row)">
              <el-option v-for="opt in rowOptions" :key="opt.value" :value="opt.value" :label="opt.label"
                :disabled="opt.value === row.id" />
            </el-select>
            <div v-else-if="col.key === 'predecessor'" class="cell" @click="startEdit(row, 'predecessor')"
              @dblclick.stop="openCard(row)">{{ predecessorLabel(row) || '—' }}</div>

            <el-select v-else-if="col.key === 'status' && isEditing(row, 'status')" v-model="row.status"
              size="small" style="width:100%" @change="commitCell(row, 'status', row.status)"
              @visible-change="(v) => !v && commitCell(row, 'status', row.status)">
              <el-option v-for="s in statusOptions" :key="s.value" :value="s.value" :label="s.label" />
            </el-select>
            <div v-else-if="col.key === 'status'" class="cell status-cell" @click="startEdit(row, 'status')"
              @dblclick.stop="openCard(row)">
              <el-tag size="small" :style="statusTagStyle(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </div>

            <el-input v-else-if="col.key === 'note' && isEditing(row, 'note')" v-model="row.note" size="small"
              @blur="commitCell(row, 'note', row.note)" @keyup.enter="$event.target.blur()"
              @dblclick.stop="openCard(row)" />
            <div v-else-if="col.key === 'note'" class="cell" @click="startEdit(row, 'note')"
              @dblclick.stop="openCard(row)">{{ row.note || '—' }}</div>

            <el-tooltip v-else-if="col.key === 'track' && lastTrack(row)" placement="top" :show-after="200">
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
            <span v-else-if="col.key === 'track'" class="tip">—</span>

            <el-button v-else-if="col.key === 'logs'" link type="primary" size="small" @click="openLogs(row)">
              日志{{ row.logs_count || 0 }}
            </el-button>

            <el-select v-else-if="col.key === 'project' && isEditing(row, 'project')" v-model="row.project"
              size="small" filterable style="width:100%" @change="commitCell(row, 'project', row.project)"
              @dblclick.stop="openCard(row)">
              <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
            </el-select>
            <div v-else-if="col.key === 'project'" class="cell" @click="startEdit(row, 'project')"
              @dblclick.stop="openCard(row)">{{ row.project || '—' }}</div>

            <span v-else-if="col.key === 'hours'">{{ row.hours }}</span>
            <span v-else-if="col.key === 'man_days'">{{ row.man_days }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="176" fixed="right">
          <template #default="{ row }">
            <el-button v-if="auth.has('ISSUE_CREATE')" type="primary" size="small" @click="openCard(row)">编辑</el-button>
            <el-button v-if="auth.has('ISSUE_CREATE')" type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
          </el-table>
        </div>
        <div v-if="ganttVisible" class="pane-divider" title="拖动调整宽度，双击重置"
          @pointerdown="startResize" @dblclick="resetResize">
          <span class="divider-grip" />
        </div>
        <div v-if="ganttVisible" class="gantt-pane">
          <el-button class="gantt-hide" size="small" text bg @click="ganttVisible = false">隐藏</el-button>
          <div ref="ganttScroll" class="gantt-scroll" @scroll="onGanttScroll">
            <div class="gantt-head" :style="{ width: `${ganttWidth}px` }">
              <div class="gantt-months">
                <div v-for="m in ganttMonths" :key="m.key" class="gantt-month"
                  :style="{ width: `${m.days * cellWidth}px` }">{{ m.label }}</div>
              </div>
              <div class="gantt-days">
                <div v-for="d in ganttDays" :key="d.key" class="gantt-day" :class="{ weekend: d.weekend }"
                  :style="{ width: `${cellWidth}px` }">{{ d.label }}</div>
              </div>
            </div>
            <div class="gantt-body">
              <div v-for="row in filteredRows" :key="row.id" class="gantt-row"
                :class="{ 'dirty-row': row._dirty, 'selected-row': selection.some((s) => s.id === row.id),
                  'editing-row': editingRowId === row.id }"
                :style="{ width: `${ganttWidth}px` }" @dblclick="openCard(row)">
                <div class="gantt-track" :style="{ width: `${ganttWidth}px` }">
                  <div v-for="d in ganttDays" :key="d.key" class="gantt-grid-cell" :class="{ weekend: d.weekend }"
                    :style="{ width: `${cellWidth}px` }" />
                  <div v-if="ganttBar(row)" class="gantt-bar" :class="{ summary: !!row.has_children }"
                    :style="{ left: `${ganttBar(row).left}px`, width: `${ganttBar(row).width}px` }"
                    :title="`${row.title}：${row.start_date || ''} ~ ${row.end_date || ''}（${ganttBar(row).days} 个工作日）`">
                    <span class="gantt-bar-label">{{ shortTaskTitle(row.title) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="!rows.length" class="empty">暂无计划，点击「批量新增行」或「导入 Excel」开始编写</div>
    </el-card>

    <el-dialog v-model="addRowsDialog" :title="addRowsDialogTitle" width="440px" align-center>
      <el-form label-width="90px" size="small">
        <el-form-item label="插入层级">
          <el-radio-group v-model="addRowsMode">
            <el-radio-button value="sibling">同级次</el-radio-button>
            <el-radio-button value="child" :disabled="!addRowsAnchor">下级次</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="addRowsIntent === 'batch'" label="新增行数">
          <el-input-number v-model="addRowsCount" :min="1" :max="50" controls-position="right" />
        </el-form-item>
      </el-form>
      <div class="hint">
        <template v-if="addRowsAnchor">
          同级次：与「{{ addRowsAnchor.wbs }} {{ addRowsAnchor.title }}」使用相同上级；下级次：以该行为上级。
          分类、上级任务和任务名称前缀会自动带出，WBS 与序号将按新层级重新调整。
        </template>
        <template v-else>未选中行，将追加到清单末尾并重新调整 WBS 与序号。</template>
      </div>
      <template #footer>
        <el-button @click="addRowsDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmAddRows">确定</el-button>
      </template>
    </el-dialog>

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
            <el-form-item label="序号">
              <el-input v-model="form.seq_no" placeholder="如 1.2，自动推导上级" @change="onFormSeqChange" />
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
                <el-option v-for="p in parentOptions" :key="p.id" :value="p.id" :label="optionLabel(p)" />
              </el-select>
              <div v-if="editing?._new" class="hint">非一级任务请先选择上级；选择后任务名称会自动带上直接上级名称</div>
            </el-form-item>
            <el-form-item label="任务名称" required>
              <el-input v-model="form.title" maxlength="255" :disabled="editing?._new && !form.parentReady"
                :placeholder="editing?._new && !form.parentReady ? '请先选择上级任务' : '请输入任务名称'" />
            </el-form-item>
            <el-form-item v-for="key in personKeys" :key="key"
              :label="key === 'owner' ? '负责人' : (key === 'assistant1' ? '配合人1' : '配合人2')">
              <el-select v-model="form[key]" filterable clearable placeholder="请选择人员">
                <el-option v-for="name in personOptionsWith(form[key])" :key="name" :value="name" :label="name" />
              </el-select>
            </el-form-item>
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

    <el-dialog v-model="batchDialog" title="批量行内修改" width="420px">
      <el-form label-width="90px">
        <el-form-item label="目标字段">
          <el-select v-model="batchField" style="width:100%" @change="onBatchFieldChange">
            <el-option v-for="f in batchFields" :key="f.key" :value="f.key" :label="f.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标值">
          <el-select v-if="batchOptions.length" v-model="batchValue" filterable style="width:100%"
            :placeholder="batchIsDate ? '请选择日期' : '请选择'">
            <el-option v-for="o in batchOptions" :key="o" :value="o" :label="o" />
          </el-select>
          <el-date-picker v-else-if="batchIsDate" v-model="batchValue" type="date" value-format="YYYY-MM-DD"
            style="width:100%" />
          <el-input v-else v-model="batchValue" placeholder="请输入" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="primary" :loading="batchSaving" :disabled="!batchValue"
          @click="applyBatch">应用到 {{ selection.filter((r) => !r._new).length }} 行</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="columnSettingDialog" title="列设置" width="420px">
      <div class="tip" style="margin-bottom:10px">勾选显示的列；在表头上按住鼠标拖拽可调整列顺序。</div>
      <el-checkbox-group v-model="shownColumnKeys" class="column-settings">
        <el-checkbox v-for="col in columns" :key="col.key" :value="col.key">{{ col.label }}</el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="columnSettingDialog = false">关闭</el-button>
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
        title="仅支持 .xlsx 文件；先选择文件并确认字段对照，再导入；成功/失败行数会分别统计，失败记录可下载清单修改后重新导入" />
      <div class="toolbar">
        <input ref="planXlsxInput" type="file" accept=".xlsx" style="display:none" @change="pickPlanImportFile" />
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
          带「序号」列（如 1、1.2、1.2.1）可自动识别父子层级并生成 WBS；有起止日期时工时/人天按工作日历自动计算。导出的 Excel 可直接重新导入。
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
.ops { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; align-items: center; }
.ops-label { font-size: 12px; color: var(--el-text-color-secondary); }
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
.wbs-expand { display: inline-block; min-width: 12px; margin-right: 4px;
  color: var(--el-color-primary); font-weight: 700; cursor: pointer; }
.imp-title { font-weight: 600; margin: 12px 0 8px; }
.imp-errors { margin-top: 8px; max-height: 120px; overflow: auto; font-size: 12px;
  color: var(--el-color-danger); line-height: 1.7; }
.status-cell { display: flex; align-items: center; }
.column-settings { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.plan-grid :deep(.plan-table th.el-table__cell[draggable='true']) { cursor: grab; }
.plan-grid :deep(.plan-table th.el-table__cell[draggable='true']:active) { cursor: grabbing; }
:deep(.plan-table .el-table__fixed-right td.el-table__cell) {
  background-color: var(--el-bg-color) !important;
}
/* 统一行背景：淡色斑马纹 + 轻微悬停高亮 */
:deep(.plan-table .el-table__body tr.el-table__row--striped > td.el-table__cell) {
  background: color-mix(in srgb, var(--el-fill-color-light) 55%, var(--el-bg-color));
}
:deep(.plan-table .el-table__body tr:hover > td.el-table__cell) {
  background: color-mix(in srgb, var(--el-color-primary) 8%, var(--el-bg-color));
}
:deep(.plan-table tr.summary-row > td.el-table__cell) { font-weight: 600; }
:deep(.plan-table tr.dirty-row > td.el-table__cell),
:deep(.plan-table .el-table__fixed-left tr.dirty-row > td.el-table__cell),
:deep(.plan-table .el-table__fixed-right tr.dirty-row > td.el-table__cell) {
  background: color-mix(in srgb, var(--el-color-warning) 16%, var(--el-bg-color)) !important;
}
:deep(.plan-table tr.selected-row > td.el-table__cell),
:deep(.plan-table .el-table__fixed-left tr.selected-row > td.el-table__cell),
:deep(.plan-table .el-table__fixed-right tr.selected-row > td.el-table__cell) {
  background: color-mix(in srgb, var(--el-color-primary) 13%, var(--el-bg-color)) !important;
}
:deep(.plan-table tr.editing-row > td.el-table__cell),
:deep(.plan-table .el-table__fixed-left tr.editing-row > td.el-table__cell),
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
.gantt-pane { position: relative; flex: 1; min-width: 300px; min-height: 0;
  border: 1px solid var(--el-border-color-lighter); border-radius: 4px; overflow: hidden; }
.gantt-pane .gantt-hide { position: absolute; right: 6px; top: 7px; z-index: 5; height: 26px; padding: 0 9px; }
.plan-grid :deep(.plan-table) { height: 100%; }
.plan-grid :deep(.plan-table th.el-table__cell) { height: 42px; padding: 0; position: relative; }
.plan-grid :deep(.col-resize-handle) { position: absolute; top: 0; right: -3px; width: 6px; height: 100%;
  cursor: col-resize; z-index: 4; }
.plan-grid :deep(.col-resize-handle::after) { content: ''; position: absolute; top: 8px; bottom: 8px; left: 2px;
  width: 2px; border-radius: 1px; background: transparent; }
.plan-grid :deep(.col-resize-handle:hover::after) { background: var(--el-color-primary); }
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
.gantt-bar { position: absolute; top: 9px; height: 16px; border-radius: 8px; overflow: hidden;
  background: var(--el-color-primary); opacity: 0.92; }
.gantt-bar.summary { background: var(--el-color-success); }
.gantt-bar-label { display: block; max-width: 100%; padding: 0 6px; color: #fff; font-size: 10px;
  line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
