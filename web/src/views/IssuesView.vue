<script setup>
// 问题跟踪列表页：筛选 / 表格 / 分页 / 新增编辑 / 详情 / 日志 / 批量 / 分配
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Filter } from '@element-plus/icons-vue'
import BackHome from '@/components/BackHome.vue'
import TrackRecords from '@/components/TrackRecords.vue'
import { useAuthStore } from '@/store/auth'
import { useBreakpoint } from '@/composables/useBreakpoint'
import http from '@/api/http'
import {
  listIssues, filterOptions, getIssue, createIssue, updateIssue, deleteIssue,
  batchIssues, batchDeleteIssues, assignIssue, issueLogs, uploadImage, exportIssues,
  importIssues, importFields, readImportHeaders,
} from '@/api/issues'

const auth = useAuthStore()
const route = useRoute()
const { isMobile } = useBreakpoint()

// ---------- 元数据（字典/人员/必填字段） ----------
const meta = ref({ dicts: {}, personnel: [], fields: [], required: [] })
const dictOf = (key) => meta.value.dicts[key] ?? []
const personOptions = computed(() => meta.value.personnel.map((p) => p.name))
const fieldLabel = (key) => meta.value.fields.find((f) => f.key === key)?.label ?? key

const tagStyle = (dictKey, val) => {
  const item = dictOf(dictKey).find((d) => d.value === val)
  if (!item) return {}
  return { color: item.color, borderColor: item.color, backgroundColor: item.color + '22' }
}
const prioTagType = (p) => ({ C: 'danger', H: 'warning', M: 'primary', L: 'info' })[p] ?? 'info'
// API 的 pg DATE 为 UTC ISO（如 2026-11-14T16:00:00Z 表示本地 11-15），按本地日期显示
const fmtDate = (v) => {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const isDateKey = (k) => dateFields.includes(k)

// ---------- 列表状态 ----------
const loading = ref(false)
const exportBusy = ref(false)
const list = ref([])
const total = ref(0)
// 每列一个筛选状态（与后端 FILTERABLE 对齐），表头下拉与工具栏共用
const FILTER_KEYS = [
  'seq', 'project', 'stage', 'type', 'module', 'desc', 'priority', 'impact',
  'reporter', 'reported_at', 'owner', 'plan_start', 'plan_end', 'developer',
  'pending_test', 'status', 'resolved_at', 'customer_test', 'customer_test_done',
]
const blankFilters = () => Object.fromEntries(FILTER_KEYS.map((k) => [k, []]))
const query = reactive({ page: 1, pageSize: 50, q: '', ...blankFilters() })
// 下钻提示（值已并入 query，extra 仅用于展示提示条）
const extra = reactive({ developer: '', module: '', type: '', overdue: '' })
const selected = ref([])
// 表格锁定：'' 不锁定 / 'header' 仅锁定表头 / 'both' 表头+左右列都锁定（偏好存本地）
const lockMode = ref(localStorage.getItem('issue_lock_mode') ?? '')
const TABLE_MAX_HEIGHT = 'calc(100vh - 180px)'
const leftFixed = computed(() => (lockMode.value === 'both' ? 'left' : undefined))
// 锁定行列时固定前 5 个数据列（项目/阶段/类型/模块/需求描述），加上多选、序号共固定前 7 列
const FIXED_DATA_COLS = 5
const colFixed = (i) => (lockMode.value === 'both' && i < FIXED_DATA_COLS ? 'left' : undefined)
function setLockMode(val) {
  localStorage.setItem('issue_lock_mode', val ?? '')
}

const filterParams = () => {
  const p = { page: query.page, pageSize: query.pageSize }
  if (query.q) p.q = query.q
  for (const k of FILTER_KEYS) if (query[k].length) p[k] = query[k].join(',')
  if (extra.overdue) p.overdue = '1'
  return p
}
// 表头筛选候选值（全量数据去重，跨页可选）
const filterOpts = ref({})
async function load() {
  loading.value = true
  try {
    const [data, opts] = await Promise.all([listIssues(filterParams()), filterOptions()])
    list.value = data.list
    total.value = data.total
    filterOpts.value = opts || {}
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
// 每页行数：下拉选择 + 手工输入（回车/失焦生效）；上限与后端校验一致
const PAGE_SIZE_MAX = 2000
const pageSizeInput = ref(query.pageSize)
watch(() => query.pageSize, (v) => { pageSizeInput.value = v })
function applyPageSize() {
  let n = Math.floor(Number(pageSizeInput.value) || query.pageSize)
  if (n < 1) n = 1
  if (n > PAGE_SIZE_MAX) {
    n = PAGE_SIZE_MAX
    ElMessage.warning(`每页行数最大为 ${PAGE_SIZE_MAX}，已自动调整`)
  }
  pageSizeInput.value = n
  if (n === query.pageSize) return
  query.pageSize = n
  query.page = 1
  load()
}
function search() { query.page = 1; load() }
function reset() {
  Object.assign(query, { page: 1, q: '', ...blankFilters() })
  Object.assign(extra, { developer: '', module: '', type: '', overdue: '' })
  load()
}

// 表头下拉筛选：EP 只负责展示勾选，实际过滤交给后端（避免只筛当前页）
const tableRef = ref()
function onFilterChange(filters) {
  // EP 的 filter-change 以列 id 为键，需映射回字段名
  const cols = tableRef.value?.store?.states?.columns?.value || []
  let changed = false
  for (const [id, val] of Object.entries(filters)) {
    const k = cols.find((c) => c.id === id)?.property
    if (!k || !FILTER_KEYS.includes(k) || isDateKey(k)) continue
    const v = Array.isArray(val) ? val : []
    if (JSON.stringify(v) !== JSON.stringify(query[k])) {
      query[k] = v
      changed = true
      if (k in extra) extra[k] = ''
    }
  }
  if (changed) { query.page = 1; load() }
}

// ---------- 表格列（响应式收缩，手机端精简列） ----------
const columns = computed(() => {
  const full = [
    { key: 'project', dict: 'project' }, { key: 'stage', dict: 'stage' }, { key: 'type', dict: 'type' },
    { key: 'module', dict: 'module' }, { key: 'desc' }, { key: 'priority', dict: 'priority' },
    { key: 'impact', dict: 'impact' }, { key: 'reporter', person: true }, { key: 'reported_at' },
    { key: 'owner', person: true }, { key: 'plan_end' }, { key: 'developer', person: true },
    { key: 'pending_test', dict: 'pending_test' }, { key: 'status', dict: 'status' },
    { key: 'resolved_at' }, { key: 'customer_test', dict: 'customer_test' },
    { key: 'customer_test_done' },
  ]
  const mobileKeys = ['project', 'desc', 'priority', 'status', 'owner']
  return (isMobile.value ? full.filter((c) => mobileKeys.includes(c.key)) : full)
})

// Excel 式筛选：候选值来自全量数据去重（后端 filter-options），跨页可选；含已选项保证勾选不丢
// 后端对该列存在 NULL/空串时追加 EMPTY_MARK，前端显示为「空值」（序号/项目/需求描述列不提供筛选）
const EMPTY_MARK = '__EMPTY__'

// 日期列：Excel 式年→月→日级联筛选；最终仍以 YYYY-MM-DD 交给后端过滤
const DATE_CASCADER_PROPS = { multiple: true, checkStrictly: true, emitPath: false, expandTrigger: 'click' }
const dateFilterVisible = reactive({})
const dateFilterDrafts = reactive({})

const dateFilterTrees = computed(() => {
  const map = {}
  for (const key of dateFields) {
    const dates = new Set()
    let hasEmpty = false
    for (const raw of [...(filterOpts.value[key] || []), ...(query[key] || [])]) {
      const value = String(raw)
      if (value === EMPTY_MARK) hasEmpty = true
      else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) dates.add(value)
    }
    const years = new Map()
    for (const date of [...dates].sort().reverse()) {
      const [year, month] = date.split('-')
      if (!years.has(year)) years.set(year, new Map())
      const months = years.get(year)
      if (!months.has(month)) months.set(month, [])
      months.get(month).push(date)
    }
    const tree = [...years.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, months]) => ({
        value: year,
        label: `${year}年`,
        children: [...months.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([month, days]) => ({
            value: `${year}-${month}`,
            label: `${Number(month)}月`,
            children: days.sort((a, b) => b.localeCompare(a))
              .map((date) => ({ value: date, label: `${Number(date.slice(8))}日` })),
          })),
      }))
    if (hasEmpty) tree.push({ value: EMPTY_MARK, label: '（空值）' })
    map[key] = tree
  }
  return map
})

// 已选日期还原成级联勾选：整年/整月全选时显示父节点，否则显示具体日期
const dateFilterModels = computed(() => {
  const map = {}
  for (const key of dateFields) {
    const selected = new Set(query[key] || [])
    const values = []
    for (const year of dateFilterTrees.value[key] || []) {
      if (year.value === EMPTY_MARK) {
        if (selected.has(EMPTY_MARK)) values.push(EMPTY_MARK)
        continue
      }
      const yearDates = year.children.flatMap((m) => m.children.map((d) => d.value))
      if (yearDates.length && yearDates.every((d) => selected.has(d))) {
        values.push(year.value)
        continue
      }
      for (const month of year.children) {
        const monthDates = month.children.map((d) => d.value)
        if (monthDates.length && monthDates.every((d) => selected.has(d))) {
          values.push(month.value)
          continue
        }
        for (const day of month.children) if (selected.has(day.value)) values.push(day.value)
      }
    }
    map[key] = values
  }
  return map
})

function expandDateValues(key, values) {
  const expandable = new Map()
  for (const node of dateFilterTrees.value[key] || []) {
    if (node.value === EMPTY_MARK) {
      expandable.set(EMPTY_MARK, [EMPTY_MARK])
      continue
    }
    expandable.set(node.value, node.children.flatMap((m) => m.children.map((d) => d.value)))
    for (const month of node.children) expandable.set(month.value, month.children.map((d) => d.value))
  }
  const result = new Set()
  for (const value of values || []) {
    if (value === EMPTY_MARK) {
      result.add(EMPTY_MARK)
      continue
    }
    for (const date of expandable.get(value) || [value]) result.add(date)
  }
  return [...result]
}

function openDateFilter(key) {
  dateFilterDrafts[key] = [...(dateFilterModels.value[key] || [])]
}
function applyDateFilter(key, values) {
  const next = expandDateValues(key, values)
  if (JSON.stringify(next) === JSON.stringify(query[key] || [])) return
  query[key] = next
  if (key in extra) extra[key] = ''
  query.page = 1
  load()
}
function confirmDateFilter(key) {
  applyDateFilter(key, dateFilterDrafts[key] || [])
  dateFilterVisible[key] = false
}
function clearDateFilter(key) {
  dateFilterDrafts[key] = []
  applyDateFilter(key, [])
  dateFilterVisible[key] = false
}

const columnFilters = computed(() => {
  const map = {}
  for (const c of columns.value) {
    const k = c.key
    if (k === 'project' || k === 'desc' || isDateKey(k)) continue
    // 日期候选值后端已转 YYYY-MM-DD 文本，直接截取，避免 fmtDate 的 UTC 解析错位
    const vals = new Set((filterOpts.value[k] || []).map((v) => (v === EMPTY_MARK ? v : isDateKey(k) ? String(v).slice(0, 10) : String(v))))
    for (const v of query[k] || []) vals.add(v)
    map[k] = [...vals].sort((a, b) => {
      if (a === EMPTY_MARK) return 1
      if (b === EMPTY_MARK) return -1
      return a.localeCompare(b, 'zh')
    })
      .slice(0, 200)
      .map((v) => ({ text: v === EMPTY_MARK ? '（空值）' : (v.length > 30 ? `${v.slice(0, 30)}…` : v), value: v }))
  }
  return map
})

// 除需求描述/跟踪记录外的列：按表头与单元格内容估算自适应宽度（CJK 按全宽、其余按半宽）
const textWidth = (s) => {
  if (s === null || s === undefined || s === '') return 0
  let w = 0
  for (const ch of String(s)) w += /[\u2E80-\uFFF0\uFF01-\uFF60]/.test(ch) ? 12 : 6.5
  return w
}
const contentWidths = computed(() => {
  const map = {}
  for (const c of columns.value) {
    if (c.key === 'desc') continue
    // 表头宽度：带筛选漏斗的列多留图标空间
    let max = textWidth(fieldLabel(c.key)) + (c.key === 'project' ? 26 : 46)
    for (const r of list.value) {
      const v = isDateKey(c.key) ? fmtDate(r[c.key]) : r[c.key]
      max = Math.max(max, textWidth(v) + (c.dict || c.key === 'priority' ? 34 : 24))
    }
    map[c.key] = Math.min(Math.max(Math.round(max), 80), 360)
  }
  return map
})

// ---------- 新增/编辑表单 ----------
const dialog = ref(false)
const editing = ref(null) // null=新增
const formRef = ref()
const form = reactive({})
const formFields = computed(() => meta.value.fields.filter((f) => f.key !== 'track'))
const dateFields = ['reported_at', 'plan_start', 'plan_end', 'resolved_at', 'customer_test_done']
const optionsFor = (key) => {
  if (['reporter', 'owner', 'developer'].includes(key)) return personOptions.value
  return dictOf(key).map((d) => d.value)
}
// 实际完成有日期且客户测试=是 → 状态自动置为已解决（用户改动这两个字段时触发）
function onFieldChange(key) {
  if ((key === 'resolved_at' || key === 'customer_test') && form.resolved_at && form.customer_test === '是') {
    form.status = '已解决'
  }
}

function openCreate() {
  editing.value = null
  Object.keys(form).forEach((k) => delete form[k])
  for (const f of meta.value.fields) form[f.key] = ''
  // 登记默认值：提出人=当前操作人、状态=未开始、提出日期=今天（本地日期）
  form.reporter = auth.user?.person || ''
  form.status = '未开始'
  form.reported_at = fmtDate(new Date())
  // 单项目账号自动预填归属项目
  if (Array.isArray(auth.scope) && auth.scope.length === 1) form.project = auth.scope[0]
  form.track = []
  dialog.value = true
}
async function openEdit(row) {
  const d = await getIssue(row.seq)
  editing.value = d
  Object.keys(form).forEach((k) => delete form[k])
  for (const f of meta.value.fields) {
    const v = d[f.key]
    form[f.key] = dateFields.includes(f.key) ? fmtDate(v) : (v ?? '')
  }
  form.custom_fields = d.custom_fields || {}
  form.track = Array.isArray(d.track) ? d.track : []
  dialog.value = true
}
async function submitForm() {
  try {
    // 必填校验（档案 required-fields 配置驱动）
    for (const f of meta.value.required) {
      if (!form[f] || form[f] === '') { ElMessage.warning(`「${fieldLabel(f)}」为必填项`); return }
    }
    const payload = { ...form }
    // 兜底：满足完成+客户测试条件时状态强制已解决
    if (payload.resolved_at && payload.customer_test === '是') payload.status = '已解决'
    for (const k of dateFields) if (!payload[k]) payload[k] = null
    // jsonb 字段归一化：track 数组 / custom_fields 对象
    payload.track = Array.isArray(payload.track) ? payload.track : []
    payload.custom_fields = (payload.custom_fields && typeof payload.custom_fields === 'object') ? payload.custom_fields : {}
    for (const k of ['stage', 'type', 'module', 'impact', 'reporter', 'owner', 'developer', 'pending_test', 'customer_test', 'solution', 'image_url']) {
      if (payload[k] === undefined) payload[k] = null
    }
    if (editing.value) {
      await updateIssue(editing.value.seq, payload)
      ElMessage.success(`问题 #${editing.value.seq} 已保存（变更留痕）`)
    } else {
      const d = await createIssue(payload)
      ElMessage.success(`问题 #${d.seq} 已登记`)
    }
    dialog.value = false
    load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 图片上传
const imageFileList = ref([])
async function onImageUpload(options) {
  try {
    // el-upload 的 on-change 参数即 UploadFile：name 在自身，原生 File 在 .raw
    const file = options.raw || options.file
    if (!file) return ElMessage.error('未获取到图片文件')
    const d = await uploadImage(file)
    form.image_url = d.url
    imageFileList.value = [{ name: options.name || file.name || 'image.png', url: d.url }]
    ElMessage.success('图片已上传')
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// ---------- 详情抽屉 ----------
const drawer = ref(false)
const detail = ref(null)
async function openDetail(row) {
  detail.value = await getIssue(row.seq)
  drawer.value = true
}

// ---------- 日志 ----------
const logDialog = ref(false)
const logList = ref([])
const logTitle = ref('')
async function openLogs(row) {
  logTitle.value = `问题 #${row.seq} 修改日志`
  logList.value = await issueLogs(row.seq)
  logDialog.value = true
}
const fmtTime = (t) => String(t).slice(0, 19).replace('T', ' ')

// ---------- 行内分配 ----------
async function quickAssign(row, field) {
  const { value } = await ElMessageBox.prompt(`为问题 #${row.seq} 指定${fieldLabel(field)}`, '行内分配', {
    inputValue: row[field] || '',
    inputValidator: (v) => (v && personOptions.value.includes(v)) || '请从人员档案中选择',
    autocomplete: 'off',
  })
  await assignIssue(row.seq, field, value)
  ElMessage.success(`已分配：${value}（已生成通知）`)
  load()
}

// ---------- 删除 ----------
async function removeOne(row) {
  await ElMessageBox.confirm(`确认删除问题 #${row.seq}「${row.desc}」？`, '删除', { type: 'warning' })
  await deleteIssue(row.seq)
  ElMessage.success('已删除（日志级联清理）')
  load()
}
async function removeSelected() {
  const seqs = selected.value.map((r) => r.seq)
  if (!seqs.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${seqs.length} 条问题？该操作不可恢复（日志一并清理）。`, '批量删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  try {
    const results = await batchDeleteIssues(seqs)
    const okCount = results.filter((r) => r.ok).length
    const failed = results.filter((r) => !r.ok)
    if (failed.length) ElMessage.warning(`已删除 ${okCount} 条，失败 ${failed.length} 条：${failed[0].message}`)
    else ElMessage.success(`已删除 ${okCount} 条`)
    selected.value = []
    load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// ---------- 批量修改 ----------
const batchDialog = ref(false)
const batchField = ref('status')
const batchValue = ref('')
async function applyBatch() {
  const patch = { [batchField.value]: batchValue.value }
  const results = await batchIssues(selected.value.map((r) => r.seq), patch)
  const failed = results.filter((r) => !r.ok)
  if (failed.length) ElMessage.warning(`${results.length - failed.length} 行成功，${failed.length} 行失败`)
  else ElMessage.success(`已批量更新 ${results.length} 行（逐行留痕）`)
  batchDialog.value = false
  selected.value = []
  load()
}

// ---------- 导入导出 ----------
// 导出按当前筛选条件（含所选项目）取全部记录，不携带列表分页参数
const exportParams = () => {
  const p = filterParams()
  delete p.page
  delete p.pageSize
  return p
}
async function doExport() {
  exportBusy.value = true
  try {
    const blob = await exportIssues(exportParams())
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `问题跟踪-${new Date().toISOString().slice(0, 10)}.xlsx`
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
const importDialog = ref(false)
const importBusy = ref(false)
const importFile = ref(null)
const importFieldsList = ref([])
const importHeaders = ref([])
const importMapping = reactive({})
const importResult = ref(null)

async function openImport() {
  importFile.value = null
  importHeaders.value = []
  Object.keys(importMapping).forEach((k) => delete importMapping[k])
  importResult.value = null
  importDialog.value = true
  if (!importFieldsList.value.length) importFieldsList.value = await importFields()
}

async function pickImportFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  importBusy.value = true
  importResult.value = null
  try {
    const d = await readImportHeaders(file)
    importFile.value = file
    importHeaders.value = d.headers
    // 自动对照：表头同名优先，其次包含匹配
    for (const f of importFieldsList.value) {
      const exact = d.headers.find((h) => h.label === f.label)
      const guess = exact || d.headers.find((h) => h.label.includes(f.label) || f.label.includes(h.label))
      importMapping[f.key] = guess?.label || ''
    }
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    importBusy.value = false
  }
}

async function doImport() {
  const missing = importFieldsList.value.filter((f) => ['project', 'desc', 'priority', 'status'].includes(f.key) && !importMapping[f.key])
  if (missing.length) ElMessage.warning(`必填列未映射：${missing.map((f) => f.label).join('、')}；将生成失败清单供修正`)
  importBusy.value = true
  try {
    importResult.value = await importIssues(importFile.value, { ...importMapping })
    load()
  } catch (err) {
    // 后端结构性错误（表头/映射问题）也会返回失败清单
    const body = err.body || {}
    importResult.value = {
      message: err.message,
      imported: 0,
      failed: (body.failUrl || body.details?.failUrl) ? '全部' : 0,
      errors: body.details?.errors || body.errors || [],
      failUrl: body.failUrl || body.details?.failUrl || null,
    }
  } finally {
    importBusy.value = false
  }
}

onMounted(async () => {
  const [cfg, required] = await Promise.all([
    http.get('/config/fields'),
    http.get('/archives/required-fields'),
  ])
  meta.value.dicts = cfg.dicts
  meta.value.personnel = cfg.personnel
  meta.value.fields = cfg.fields
  meta.value.required = required

  // 统计/工作台下钻参数
  const qs = route.query
  if (qs.q) query.q = String(qs.q)
  for (const k of ['project', 'status', 'priority', 'owner']) {
    if (qs[k]) query[k] = String(qs[k]).split(',')
  }
  for (const k of ['developer', 'module', 'type']) {
    if (qs[k]) {
      extra[k] = String(qs[k])
      query[k] = [String(qs[k])]
    }
  }
  if (qs.overdue) extra.overdue = '1'

  await load()
  if (qs.seq) openDetail({ seq: Number(qs.seq) })
})
</script>

<template>
  <div style="padding: 14px 20px 64px">
    <!-- 工具栏：返回/项目筛选/查询 靠左，其余操作靠右 -->
    <div class="toolbar">
      <BackHome />
      <el-select v-model="query.project" multiple collapse-tags placeholder="项目" clearable style="width: 170px">
        <el-option v-for="d in dictOf('project')" :key="d.value" :value="d.value" :label="d.value" />
      </el-select>
      <el-button @click="search">查询</el-button>
      <el-input v-model="query.q" placeholder="搜索描述/方案" clearable style="width: 220px" @keyup.enter="search" />
      <el-button type="primary" :disabled="!auth.has('ISSUE_CREATE')" @click="openCreate">登记问题</el-button>
      <el-button :disabled="!auth.has('ISSUE_IMPORT')" @click="openImport">导入 Excel</el-button>
      <el-button :loading="exportBusy" :disabled="!auth.has('DATA_EXPORT') || exportBusy" @click="doExport">导出 Excel</el-button>
      <el-button :disabled="!auth.has('ISSUE_BATCH') || !selected.length" @click="batchDialog = true">
        批量修改（{{ selected.length }}）
      </el-button>
      <el-button :disabled="!auth.has('ISSUE_DELETE') || !selected.length" @click="removeSelected">
        批量删除（{{ selected.length }}）
      </el-button>
      <el-tooltip content="锁定表头：滚动时表头固定；锁定行列：表头与首尾列同时固定" placement="bottom">
        <el-select v-model="lockMode" style="margin-left:auto; width: 130px" @change="setLockMode">
          <el-option label="不锁定" value="" />
          <el-option label="锁定表头" value="header" />
          <el-option label="锁定行列" value="both" />
        </el-select>
      </el-tooltip>
    </div>

    <!-- 下钻筛选提示 -->
    <el-alert v-if="extra.overdue || extra.developer || extra.module || extra.type" type="info" :closable="false"
      style="margin-bottom:10px; padding:4px 12px">
      <span style="font-size:12px">
        下钻筛选：{{ extra.overdue ? '逾期未关闭' : '' }}{{ extra.developer ? ` 开发人员=${extra.developer}` : '' }}{{ extra.module ? ` 模块=${extra.module}` : '' }}{{ extra.type ? ` 类型=${extra.type}` : '' }}
        <el-button link type="primary" size="small" @click="reset">清除</el-button>
      </span>
    </el-alert>

    <!-- Excel 导入 -->
    <el-dialog v-model="importDialog" title="导入 Excel" width="720px" destroy-on-close>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
        title="先选择文件并确认字段对照，再导入；成功/失败行数会分别统计，失败记录可下载清单修改后重新导入" />
      <div class="toolbar">
        <input ref="xlsxInput" type="file" accept=".xlsx,.xls" style="display:none" @change="pickImportFile" />
        <el-button :loading="importBusy" @click="$refs.xlsxInput.click()">选择 Excel 文件</el-button>
        <span v-if="importFile" class="tip">{{ importFile.name }}（{{ importHeaders.length }} 列）</span>
      </div>
      <template v-if="importHeaders.length">
        <div class="imp-title">字段对照（必填项需指定来源列）</div>
        <el-table :data="importFieldsList" size="small" border max-height="320">
          <el-table-column label="系统字段" width="140">
            <template #default="{ row }">
              <span>{{ row.label }}</span>
              <span v-if="['project','desc','priority','status'].includes(row.key)" style="color:#e6a23c"> *</span>
            </template>
          </el-table-column>
          <el-table-column label="Excel 列">
            <template #default="{ row }">
              <el-select v-model="importMapping[row.key]" clearable filterable placeholder="不导入"
                style="width:100%">
                <el-option v-for="h in importHeaders" :key="h.col" :value="h.label" :label="`${h.label}（第${h.col}列）`" />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
        <div style="margin-top:12px; text-align:right">
          <el-button type="primary" :loading="importBusy" @click="doImport">开始导入</el-button>
        </div>
      </template>
      <template v-if="importResult">
        <el-alert :type="importResult.failed ? 'warning' : 'success'" :closable="false" show-icon
          style="margin-top:14px"
          :title="importResult.message || `导入完成：成功 ${importResult.imported} 条，失败 ${importResult.failed} 条`" />
        <div v-if="importResult.message" class="tip" style="margin-top:4px">
          成功 {{ importResult.imported }} 条，失败 {{ importResult.failed }} 条
        </div>
        <div v-if="importResult.errors?.length" class="imp-errors">
          <div v-for="(e, i) in importResult.errors.slice(0, 10)" :key="i">第 {{ e.row }} 行 · {{ e.field }}：{{ e.message }}</div>
          <div v-if="importResult.errors.length > 10" class="tip">仅显示前 10 条，完整信息见失败清单</div>
        </div>
        <div v-if="importResult.failUrl" style="margin-top:10px">
          <el-button tag="a" :href="importResult.failUrl" download type="primary" plain>下载失败记录 Excel</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 表格 -->
    <el-table ref="tableRef" :data="list" v-loading="loading" size="small" border stripe
      :max-height="lockMode ? TABLE_MAX_HEIGHT : undefined"
      @selection-change="selected = $event" @filter-change="onFilterChange">
      <el-table-column type="selection" width="40" :fixed="leftFixed" />
      <el-table-column prop="seq" label="序号" width="60" :fixed="leftFixed" />
      <template v-for="(c, i) in columns" :key="c.key">
        <!-- 项目列：无筛选漏斗（过滤在工具栏），锁定行列时左侧固定 -->
        <el-table-column v-if="c.key === 'project'" :prop="c.key" :label="fieldLabel(c.key)"
          :min-width="contentWidths.project" :fixed="colFixed(i)">
          <template #default="{ row }">
            <el-tag v-if="row[c.key]" size="small" :style="tagStyle('project', row[c.key])">{{ row[c.key] }}</el-tag>
          </template>
        </el-table-column>
        <!-- 日期列：Excel 式年→月→日级联筛选 -->
        <el-table-column v-else-if="isDateKey(c.key)" :prop="c.key" :label="fieldLabel(c.key)"
          :min-width="contentWidths[c.key] ?? 110" :fixed="colFixed(i)">
          <template #header>
            <div class="date-filter-header">
              <span>{{ fieldLabel(c.key) }}</span>
              <el-popover v-model:visible="dateFilterVisible[c.key]" trigger="click" placement="bottom-start"
                :width="560" popper-class="date-filter-popover" @show="openDateFilter(c.key)">
                <template #reference>
                  <el-icon class="date-filter-icon"><Filter /></el-icon>
                </template>
                <div class="date-filter-panel">
                  <div class="date-filter-title">按日期筛选 · {{ fieldLabel(c.key) }}</div>
                  <el-cascader-panel :options="dateFilterTrees[c.key] || []" :props="DATE_CASCADER_PROPS"
                    :model-value="dateFilterDrafts[c.key] || []"
                    @change="(v) => dateFilterDrafts[c.key] = v" />
                  <div class="date-filter-actions">
                    <el-button size="small" @click="clearDateFilter(c.key)">清空</el-button>
                    <el-button type="primary" size="small" @click="confirmDateFilter(c.key)">确定</el-button>
                  </div>
                </div>
              </el-popover>
            </div>
          </template>
          <template #default="{ row }">
            <span>{{ fmtDate(row[c.key]) }}</span>
          </template>
        </el-table-column>
        <!-- 其他列：普通 Excel 式多选筛选 -->
        <el-table-column v-else :prop="c.key" :label="fieldLabel(c.key)" :min-width="contentWidths[c.key] ?? (c.key === 'desc' ? 200 : 110)"
          :fixed="colFixed(i)" :filters="columnFilters[c.key]" :filtered-value="query[c.key]" :filter-method="() => true">
          <template #default="{ row }">
            <el-tag v-if="c.dict && row[c.key]" size="small" :style="tagStyle(c.dict, row[c.key])">{{ row[c.key] }}</el-tag>
            <el-tag v-else-if="c.key === 'priority'" size="small" :type="prioTagType(row.priority)">{{ row.priority }}</el-tag>
            <span v-else>{{ row[c.key] }}</span>
          </template>
        </el-table-column>
      </template>
      <el-table-column v-if="!isMobile" label="跟踪记录" min-width="170">
        <template #default="{ row }">
          <el-tooltip v-if="(row.track || []).length" placement="top" :show-after="200">
            <template #content>
              <div v-for="(t, i) in row.track" :key="i" style="margin:2px 0">{{ t.date }} {{ t.text }}<span v-if="t.by">（{{ t.by }}）</span></div>
            </template>
            <div class="track-cell">
              <span class="track-cell-date">{{ row.track[row.track.length - 1].date }}</span>
              <span class="track-cell-text">{{ row.track[row.track.length - 1].text }}</span>
            </div>
          </el-tooltip>
          <span v-else class="tip">—</span>
        </template>
      </el-table-column>
      <el-table-column label="修改日志" width="90">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openLogs(row)">日志{{ row.logs_count }}</el-button>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link size="small" @click="openDetail(row)">详情</el-button>
          <el-button v-if="auth.has('ISSUE_EDIT')" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="auth.has('ISSUE_DELETE')" link type="danger" size="small" @click="removeOne(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <span class="pager-label">每页</span>
      <el-input v-model="pageSizeInput" size="small" style="width: 62px" @keyup.enter="applyPageSize" @blur="applyPageSize" />
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize"
        :total="total" :page-sizes="[20, 50, 100, 200]" layout="total, sizes, prev, pager, next"
        size="small" @change="load" />
    </div>

    <!-- 新增/编辑 -->
    <el-dialog v-model="dialog" :title="editing ? `编辑问题 #${editing.seq}` : '登记新问题'" width="720px" destroy-on-close>
      <el-form ref="formRef" :model="form" label-width="110px" size="default">
        <el-row :gutter="12">
          <el-col v-for="f in formFields" :key="f.key" :span="['desc', 'solution'].includes(f.key) ? 24 : 8">
            <el-form-item :label="f.label" :required="meta.required.includes(f.key)">
              <el-select v-if="optionsFor(f.key).length" v-model="form[f.key]" filterable allow-create clearable
                :placeholder="f.label" style="width: 100%" @change="onFieldChange(f.key)">
                <el-option v-for="o in optionsFor(f.key)" :key="o" :value="o" :label="o" />
              </el-select>
              <el-date-picker v-else-if="dateFields.includes(f.key)" v-model="form[f.key]" type="date"
                value-format="YYYY-MM-DD" style="width: 100%" @change="onFieldChange(f.key)" />
              <el-input v-else-if="['desc', 'solution'].includes(f.key)" v-model="form[f.key]" type="textarea"
                :rows="f.key === 'desc' ? 2 : 2" />
              <el-input v-else v-model="form[f.key]" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 跟踪记录：时间线 + 新增/修改 -->
        <el-form-item label="跟踪记录" class="track-form-item">
          <TrackRecords v-model="form.track" />
        </el-form-item>

        <el-form-item v-if="auth.has('ISSUE_EDIT') || auth.has('ISSUE_CREATE')" label="图片">
          <el-upload :auto-upload="false" :on-change="onImageUpload" :file-list="imageFileList" :limit="1" accept="image/*">
            <el-button size="small">上传图片（≤5MB）</el-button>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer v-model="drawer" :title="detail ? `问题 #${detail.seq}` : ''" size="480px">
      <template v-if="detail">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item v-for="f in formFields" :key="f.key" :label="f.label">
            {{ isDateKey(f.key) ? fmtDate(detail[f.key]) : detail[f.key] }}
          </el-descriptions-item>
        </el-descriptions>
        <h4>跟踪记录</h4>
        <TrackRecords :model-value="detail.track || []" :editable="false" />
        <h4>修改日志（{{ (detail.logs || []).length }}）</h4>
        <el-table :data="detail.logs" size="small">
          <el-table-column prop="changed_at" label="时间" width="90">
            <template #default="{ row }">{{ fmtTime(row.changed_at) }}</template>
          </el-table-column>
          <el-table-column prop="field_label" label="字段" width="80" />
          <el-table-column prop="before_value" label="原值" width="100" show-overflow-tooltip />
          <el-table-column prop="after_value" label="新值" width="100" show-overflow-tooltip />
          <el-table-column prop="changed_by" label="操作人" width="80" />
        </el-table>
      </template>
    </el-drawer>

    <!-- 单问题日志 -->
    <el-dialog v-model="logDialog" :title="logTitle" width="760px">
      <el-table :data="logList" size="small" border max-height="480">
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.changed_at) }}</template>
        </el-table-column>
        <el-table-column prop="field_label" label="字段" width="100" />
        <el-table-column prop="before_value" label="原值" show-overflow-tooltip />
        <el-table-column prop="after_value" label="新值" show-overflow-tooltip />
        <el-table-column prop="changed_by" label="操作人" width="100" />
      </el-table>
    </el-dialog>

    <!-- 批量修改 -->
    <el-dialog v-model="batchDialog" title="批量行内修改" width="420px">
      <el-form label-width="90px">
        <el-form-item label="目标字段">
          <el-select v-model="batchField" style="width: 100%">
            <el-option v-for="f in formFields.filter((x) => x.key !== 'desc' && x.key !== 'project')" :key="f.key" :value="f.key" :label="f.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标值">
          <el-select v-if="optionsFor(batchField).length" v-model="batchValue" filterable style="width: 100%">
            <el-option v-for="o in optionsFor(batchField)" :key="o" :value="o" :label="o" />
          </el-select>
          <el-date-picker v-else-if="dateFields.includes(batchField)" v-model="batchValue" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          <el-input v-else v-model="batchValue" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!batchValue" @click="applyBatch">应用到 {{ selected.length }} 行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
/* 分页固定在浏览器视口右下角，随窗口自适应 */
.pager {
  position: fixed;
  right: 20px;
  bottom: 14px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  box-shadow: var(--el-box-shadow-light);
}
.pager-label { font-size: 12px; color: var(--el-text-color-secondary); }
h4 { margin: 16px 0 8px; }
.imp-title { font-weight: 600; margin: 6px 0 8px; }
.imp-errors { margin-top: 8px; font-size: 12px; color: var(--el-color-danger); line-height: 1.7; }

/* 跟踪记录 */
.track-form-item { display: block; }
.track-cell { display: flex; flex-direction: column; line-height: 1.4; overflow: hidden; }
.track-cell-date { color: var(--el-color-primary); font-weight: 600; font-size: 12px; }
.track-cell-text { color: var(--el-text-color-primary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 日期列表头级联筛选 */
.date-filter-header { display: flex; align-items: center; gap: 4px; }
.date-filter-icon { cursor: pointer; color: var(--el-text-color-secondary); }
.date-filter-icon:hover { color: var(--el-color-primary); }
</style>

<style>
.date-filter-popover .date-filter-panel { padding: 4px; }
.date-filter-popover .date-filter-title { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.date-filter-popover .el-cascader-panel { height: 260px; }
.date-filter-popover .date-filter-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
</style>
