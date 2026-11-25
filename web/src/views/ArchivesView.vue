<script setup>
// 基础档案设置：项目/产品/人员/字典/自定义字段/必填/通知类型/待办优先级 编辑
// 权限：按界面二级菜单（页签）细化。
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import { useAuthStore } from '@/store/auth'
import { ARCHIVE_TAB_PERM } from '@/permissionMenus'
import * as A from '@/api/archives'
import * as PA from '@/api/projectApplications'
import * as RA from '@/api/registration'
import {
  exportPersonnel, personnelImportFields as fetchPersonnelImportFields,
  readPersonnelHeaders, importPersonnel,
} from '@/api/archives'
import http from '@/api/http'

const auth = useAuthStore()
// 当前登录者是否为系统管理员：仅管理员可在人员岗位中选择管理员角色。
const currentIsSystemAdmin = computed(() => {
  const code = auth.user?.role_code
  const name = auth.user?.role
  return code === 'R01' || name === '管理员'
})
// 注册审核人：项目经理或管理员
const canReviewRegistration = computed(() =>
  currentIsSystemAdmin.value || auth.user?.role_code === 'R02' || auth.user?.role === '项目经理')
const statusTag = (s) => ({
  text: s || '已生效',
  color: s === '申请中' ? '#e6a23c' : (s === '已拒绝' ? '#f56c6c' : '#67c23a'),
})
const formatLocalTime = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const ARCHIVE_TAB_KEYS = ['projects', 'products', 'personnel', 'dict', 'custom', 'notice-types', 'todo-prios', 'required']
const canWriteTab = (key) => auth.has(ARCHIVE_TAB_PERM[key])
const visibleTabKeys = computed(() => ARCHIVE_TAB_KEYS.filter((key) => canWriteTab(key)))
const canWrite = computed(() => visibleTabKeys.value.length > 0)

const tab = ref(visibleTabKeys.value[0] || 'projects')
const loading = ref(false)

// ---------- 数据 ----------
const projects = ref([])
const products = ref([])
const roles = ref([]) // 角色档案，供人员岗位下拉选择
const personnel = ref([])
const dictItems = ref([])
const dictFilter = ref('')
const dictProjectFilter = ref([]) // 字典项按归属项目过滤（多选）：空=全部，选中=通用项+所选项目专属项
const personnelProjectFilter = ref([]) // 人员档案按所属项目过滤（多选）：空=全部，选中=含 ALL 或任一所选项目的人员
const archiveProjectFilter = ref([]) // 产品/自定义字段/通知类型/待办优先级的项目过滤（多选）
const customFields = ref([])
const reqModule = ref('issue') // issue=问题跟踪，plan=项目计划
const requiredRulesByModule = reactive({ issue: [], plan: [] })
const requiredFieldRules = computed(() => requiredRulesByModule[reqModule.value]) // [{ field_key, projects }]
const issueFieldOptions = ref([])
const planFieldOptions = ref([])
const fixedFieldDefs = ref([])
const fieldOptions = computed(() => reqModule.value === 'plan' ? planFieldOptions.value : issueFieldOptions.value)
const noticeTypes = ref([])
const todoPrios = ref([])

const DICT_KEYS = [
  { key: 'stage', label: '阶段' }, { key: 'type', label: '类型' },
  { key: 'module', label: '模块' }, { key: 'priority', label: '优先级' }, { key: 'impact', label: '影响程度' },
  { key: 'status', label: '状态' }, { key: 'pending_test', label: '待测试' }, { key: 'customer_test', label: '客户测试' },
]
const dictLabel = (k) => DICT_KEYS.find((d) => d.key === k)?.label ?? k
const projectLabel = (code) => (code === 'ALL' ? '全部项目' : (projects.value.find((p) => p.code === code)?.name ?? code))
const roleLabel = (code, row) => row?.role_name || roles.value.find((r) => r.code === code)?.name || code
// 项目计划固定字段（供“项目计划必填字段”勾选）
const PLAN_FIELD_OPTIONS = [
  { key: 'project', label: '项目' }, { key: 'title', label: '任务名称' },
  { key: 'category', label: '分类' }, { key: 'seq_no', label: '序号' },
  { key: 'owner', label: '负责人' }, { key: 'assistant1', label: '配合人1' },
  { key: 'assistant2', label: '配合人2' },
  { key: 'start_date', label: '开始时间' }, { key: 'end_date', label: '完成时间' },
  { key: 'actual_start_date', label: '实际开始' }, { key: 'actual_end_date', label: '实际完成' },
  { key: 'hours', label: '工时' }, { key: 'man_days', label: '人天' },
  { key: 'day_rate', label: '人天单价' },
  { key: 'planned_amount', label: '计划金额' }, { key: 'actual_amount', label: '实际金额' },
  { key: 'adjusted_hours', label: '调整工时' }, { key: 'status', label: '状态' },
  { key: 'note', label: '备注' }, { key: 'predecessor', label: '前置任务' },
  { key: 'track', label: '跟踪记录' },
]
// 当前用户可见的项目（前端按 scope 收敛，与后端 /archives/projects 过滤一致）
const visibleProjects = () => projects.value.filter((p) => p.enabled !== false && (!auth.scope || auth.scope.includes(p.code)))
// 项目多选选项（供各档案表单）；用户仅能选自己有权限的项目
const projectMultiOptions = () => [
  ...(auth.scope ? [] : [{ key: 'ALL', label: '全部项目（ALL）' }]),
  ...visibleProjects().map((p) => ({ key: p.code, label: `${p.code} ${p.name}` })),
]
// 项目多选表单字段（复用于产品/自定义字段/通知类型/待办优先级）
const projectsFormField = { key: 'projects', label: '所属项目', type: 'select', multiple: true,
  options: projectMultiOptions, default: [] }
// 系统管理员（可见全部项目）无需指定档案项目；其余用户新增/编辑档案时项目必填
const PROJECT_FIELD_KEYS = ['projects', 'project_code']
const requireArchiveProject = () => auth.scope !== null
const fieldRequired = (f, editingRow) => {
  if (PROJECT_FIELD_KEYS.includes(f.key)) return requireArchiveProject()
  return !!f.required && !editingRow
}
const fieldEmpty = (v) => v === '' || v == null || (Array.isArray(v) && v.length === 0)
// 按档案 projects 数组过滤（空=不过滤；选中=projects 含该项目或 ALL）
const filterByArchiveProject = (rows) => {
  const selected = archiveProjectFilter.value
  if (!selected.length) return rows
  // 所属项目含 ALL（全部项目）或与任一所选项目相交的档案才显示
  return rows.filter((r) => Array.isArray(r.projects)
    && (r.projects.includes('ALL') || r.projects.some((c) => selected.includes(c))))
}

// 固定字段 + 启用且属于该模块的自定义字段都可配置为必填；排除虚拟字段
function rebuildFieldOptions(custom = customFields.value) {
  issueFieldOptions.value = [...fixedFieldDefs.value,
    ...custom.filter((f) => f.module !== 'plan').map((f) => ({ ...f, custom: true }))]
    .filter((f) => !['track', 'custom_fields', 'image_url'].includes(f.key))
  planFieldOptions.value = [...PLAN_FIELD_OPTIONS,
    ...custom.filter((f) => f.module === 'plan').map((f) => ({ ...f, custom: true }))]
}
watch(customFields, (list) => rebuildFieldOptions(list), { deep: true })

async function loadAll() {
  loading.value = true
  try {
    const [cfg, issueRules, planRules] = await Promise.all([
      http.get('/config/fields', { params: { scope: 1 } }),
      A.getRequiredFieldRules('issue'),
      A.getRequiredFieldRules('plan'),
    ])
    fixedFieldDefs.value = cfg.fields || []
    requiredRulesByModule.issue = issueRules
    requiredRulesByModule.plan = planRules
    // 登录即可读的档案
    const done = await Promise.all([
      A.listProjects(true), A.listProducts(), A.listPersonnel(), A.listDictItems(),
      A.listCustomFields(), A.listNoticeTypes(), A.listTodoPrios(),
    ])
    ;[projects.value, products.value, personnel.value, dictItems.value,
      customFields.value, noticeTypes.value, todoPrios.value] = done
    rebuildFieldOptions(customFields.value)
    if (canWrite.value) roles.value = await A.listRoles()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
onMounted(loadAll)

// ---------- 人员档案导入/导出 ----------
const exportBusy = ref(false)
const importDialog = ref(false)
const importBusy = ref(false)
const importFile = ref(null)
const importFieldsList = ref([])
const importHeaders = ref([])
const importMapping = reactive({})
const importResult = ref(null)

async function doPersonnelExport() {
  exportBusy.value = true
  try {
    const blob = await exportPersonnel()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `人员档案-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success('导出完成')
  } catch (e) {
    ElMessage.error(`导出失败：${e.message}`)
  } finally {
    exportBusy.value = false
  }
}

async function openPersonnelImport() {
  importFile.value = null
  importHeaders.value = []
  Object.keys(importMapping).forEach((k) => delete importMapping[k])
  importResult.value = null
  importDialog.value = true
  try {
    if (!importFieldsList.value.length) importFieldsList.value = await fetchPersonnelImportFields()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function pickPersonnelFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  importBusy.value = true
  importResult.value = null
  try {
    const d = await readPersonnelHeaders(file)
    importFile.value = file
    importHeaders.value = d.headers
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

async function doPersonnelImport() {
  const missing = importFieldsList.value.filter((f) => ['code', 'name'].includes(f.key) && !importMapping[f.key])
  if (missing.length) {
    ElMessage.warning(`必填列未映射：${missing.map((f) => f.label).join('、')}`)
    return
  }
  if (!importFile.value) return ElMessage.warning('请先选择 Excel 文件')
  importBusy.value = true
  try {
    importResult.value = await importPersonnel(importFile.value, { ...importMapping })
    await loadAll()
  } catch (err) {
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

// ---------- 通用编辑对话框 ----------
const dialog = ref(false)
const editing = ref(null) // 当前编辑行（null=新增）
const cfg = ref(null) // 当前 tab 配置
const form = reactive({})
const saving = ref(false)

const isProtectedRow = (key, row) => key === 'dict' && !!row?.preset

function openDialog(tabCfg, row = null) {
  if (isProtectedRow(tab.value, row)) return ElMessage.warning('系统预置字典项不允许编辑')
  cfg.value = tabCfg
  editing.value = row
  Object.keys(form).forEach((k) => delete form[k])
  for (const f of tabCfg.form) {
    form[f.key] = row ? (row[f.key] ?? f.default ?? '') : (f.default ?? '')
    if (f.type === 'switch' && row) form[f.key] = !!row[f.key]
  }
  dialog.value = true
}

async function saveDialog() {
  for (const f of cfg.value.form) {
    // 项目字段：非系统管理员新增/编辑都必须选；标记 requiredOnEdit 的字段编辑时也必填；其余仅新增校验
    const required = PROJECT_FIELD_KEYS.includes(f.key)
      ? requireArchiveProject()
      : (f.required && (!editing.value || f.requiredOnEdit))
    if (required && fieldEmpty(form[f.key])) {
      return ElMessage.warning(`${f.label} 必填`)
    }
  }
  if (tab.value === 'personnel') {
    const name = String(form.name ?? '').trim()
    const duplicate = personnel.value.find((p) =>
      p.code !== editing.value?.code && String(p.name ?? '').trim().toLowerCase() === name.toLowerCase())
    if (duplicate) return ElMessage.warning(`姓名「${name}」已存在，不允许重复`)
    if (!currentIsSystemAdmin.value && (form.role === 'R01' || form.role === '管理员')) {
      return ElMessage.warning('仅管理员角色可将人员岗位设为管理员')
    }
  }
  const payload = {}
  for (const f of cfg.value.form) payload[f.key] = (form[f.key] === '' && !f.keepEmpty) ? null : form[f.key]
  saving.value = true
  try {
    if (editing.value) await cfg.value.api.update(editing.value, payload)
    else await cfg.value.api.create(payload)
    ElMessage.success('已保存')
    dialog.value = false
    await cfg.value.reload()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function removeRow(tabCfg, row) {
  if (isProtectedRow(tab.value, row)) return ElMessage.warning('系统预置字典项不允许删除')
  await ElMessageBox.confirm(`确认删除「${row[tabCfg.nameKey] ?? row[tabCfg.rowKey]}」？删除不可恢复。`, '删除', { type: 'warning' })
  try {
    await tabCfg.api.del(row)
    ElMessage.success('已删除')
    await tabCfg.reload()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function toggleArchive(tabCfg, row) {
  if (isProtectedRow(tab.value, row)) return ElMessage.warning('系统预置字典项不允许修改')
  const next = row.enabled === false
  const name = row[tabCfg.nameKey] ?? row[tabCfg.rowKey]
  try {
    await ElMessageBox.confirm(`确认${next ? '启用' : '禁用'}「${name}」？${next ? '启用后可在单据中选择。' : '禁用后将不能在单据中选择。'}`,
      next ? '启用' : '禁用', { type: 'warning' })
    await tabCfg.api.update(row, { [tabCfg.rowKey]: row[tabCfg.rowKey], enabled: next })
    ElMessage.success(`已${next ? '启用' : '禁用'}`)
    await tabCfg.reload()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || e)
  }
}

// ---------- 各档案配置 ----------
const colorCell = (key) => ({
  key, label: '颜色', width: 90,
  render: (row) => (row[key] ? { color: row[key] } : null),
})
const enabledCol = {
  key: 'enabled', label: '状态', width: 90,
  render: (row) => ({ text: row.enabled === false ? '已禁用' : '启用' }),
}
const presetCol = {
  key: 'preset', label: '系统预置', width: 100,
  render: (row) => ({ text: row.preset ? '是' : '否' }),
}
const enabledForm = { key: 'enabled', label: '启用', type: 'switch', default: true }
const presetForm = { key: 'preset', label: '系统预置', type: 'switch', default: false }

const projectCfg = computed(() => ({
  rowKey: 'code', nameKey: 'name',
  rows: projects.value, reload: async () => { projects.value = await A.listProjects(true) },
  cols: [
    { key: 'code', label: '编码', width: 130 }, { key: 'name', label: '名称', width: 200 },
    { key: 'status', label: '申请状态', width: 110, render: (row) => statusTag(row.status) },
    { key: 'applicant', label: '申请人', width: 110 },
    { key: 'applied_at', label: '申请时间', width: 165,
      render: (row) => ({ text: formatLocalTime(row.applied_at) }) },
    { key: 'note', label: '备注' },
    { key: 'contract_man_days', label: '合同人天', width: 110,
      render: (row) => ({ text: Number(row.contract_man_days || 0).toFixed(2) }) },
    colorCell('color'), enabledCol, presetCol,
  ],
  form: [
    { key: 'code', label: '编码', required: true, disabledOnEdit: true },
    { key: 'name', label: '名称' }, { key: 'note', label: '备注', type: 'textarea' },
    { key: 'contract_man_days', label: '合同人天', type: 'number', precision: 2, default: 0 },
    { key: 'color', label: '颜色', type: 'color' }, enabledForm, presetForm,
  ],
  api: { create: A.createProject, update: (row, d) => A.updateProject(row.code, d), del: (row) => A.deleteProject(row.code) },
}))

const productCfg = computed(() => ({
  rowKey: 'code', nameKey: 'code',
  rows: filterByArchiveProject(products.value), reload: async () => { products.value = await A.listProducts() },
  cols: [{ key: 'code', label: '编码', width: 130 }, { key: 'note', label: '备注' },
    { key: 'projects', label: '所属项目', minWidth: 180, render: (row) => ({ text: (row.projects || []).map(projectLabel).join('、') || '—' }) },
    colorCell('color'), enabledCol, presetCol],
  form: [
    { key: 'code', label: '编码', required: true, disabledOnEdit: true },
    { key: 'note', label: '备注', type: 'textarea' }, { key: 'color', label: '颜色', type: 'color' },
    projectsFormField, enabledForm, presetForm,
  ],
  api: { create: A.createProduct, update: (row, d) => A.updateProduct(row.code, d), del: (row) => A.deleteProduct(row.code) },
}))

const personnelFiltered = computed(() => {
  const selected = personnelProjectFilter.value
  if (!selected.length) return personnel.value
  // 所属项目含 ALL 或与任一所选项目相交的人员才显示
  return personnel.value.filter((p) => Array.isArray(p.projects)
    && (p.projects.includes('ALL') || p.projects.some((c) => selected.includes(c))))
})
const personnelCfg = computed(() => ({
  rowKey: 'code', nameKey: 'name',
  rows: personnelFiltered.value, reload: async () => { personnel.value = await A.listPersonnel() },
  cols: [
    { key: 'code', label: '编码', width: 110 }, { key: 'name', label: '姓名', width: 130 },
    { key: 'role', label: '岗位', width: 130, render: (row) => ({ text: roleLabel(row.role, row) }) }, { key: 'group', label: '所属组' },
    { key: 'projects', label: '所属项目', minWidth: 200,
      render: (row) => ({ text: (row.projects || []).map(projectLabel).join('、') || '—' }) },
    { key: 'day_rate', label: '个人天单价', width: 120,
      render: (row) => ({ text: Number(row.day_rate || 0).toFixed(2) }) },
    { key: 'status', label: '注册状态', width: 110, render: (row) => statusTag(row.status) },
    { key: 'applied_at', label: '申请时间', width: 165,
      render: (row) => ({ text: formatLocalTime(row.applied_at) }) },
    enabledCol, presetCol,
  ],
  form: [
    { key: 'code', label: '编码', required: true, disabledOnEdit: true },
    { key: 'name', label: '姓名', required: true },
    { key: 'role', label: '岗位', type: 'select', required: true, requiredOnEdit: true,
      options: () => {
        // 非管理员登录时，岗位下拉不提供管理员角色。
        const selectable = currentIsSystemAdmin.value
          ? roles.value
          : roles.value.filter((r) => r.code !== 'R01' && r.name !== '管理员')
        const opts = selectable.map((r) => ({ key: r.code, label: r.name }))
        const isAdminRole = form.role === 'R01' || form.role === '管理员'
        if (form.role && !isAdminRole && !opts.some((o) => o.key === form.role)) {
          opts.unshift({ key: form.role, label: roleLabel(form.role) })
        }
        return opts
      } },
    { key: 'group', label: '所属组' },
    { key: 'day_rate', label: '个人天单价', type: 'number', precision: 2, default: 0 },
    { key: 'projects', label: '所属项目', type: 'select', multiple: true, default: [], options: projectMultiOptions },
    enabledForm, presetForm,
  ],
  api: { create: A.createPersonnel, update: (row, d) => A.updatePersonnel(row.code, d), del: (row) => A.deletePersonnel(row.code) },
}))

const dictFiltered = computed(() => dictItems.value.filter((d) => {
  if (dictFilter.value && d.dict_key !== dictFilter.value) return false
  // 项目过滤（多选）：归属为空（通用）始终显示；专属项仅在选中其归属项目时显示
  if (dictProjectFilter.value.length && d.project_code && !dictProjectFilter.value.includes(d.project_code)) return false
  return true
}))
const dictCfg = computed(() => ({
  rowKey: 'id', nameKey: 'value',
  rows: dictFiltered.value, reload: async () => { dictItems.value = await A.listDictItems() },
  cols: [
    { key: 'dict_key', label: '字典', width: 110, render: (row) => ({ text: dictLabel(row.dict_key) }) },
    { key: 'value', label: '值', width: 120 }, { key: 'label', label: '显示名', width: 140 },
    { key: 'product_code', label: '所属产品', width: 110 },
    { key: 'project_code', label: '归属项目', width: 120,
      render: (row) => ({ text: row.project_code ? projectLabel(row.project_code) : '全部项目' }) },
    { key: 'note', label: '备注' }, { key: 'sort', label: '排序', width: 70 }, colorCell('color'), enabledCol, presetCol,
  ],
  form: [
    { key: 'dict_key', label: '字典', type: 'select', options: DICT_KEYS, required: true, disabledOnEdit: true },
    { key: 'value', label: '值', required: true },
    { key: 'label', label: '显示名' },
    { key: 'product_code', label: '所属产品', type: 'select', options: () => products.value.filter((p) => p.enabled !== false).map((p) => ({ key: p.code, label: p.code })), showIf: (f) => form.dict_key === 'module' },
    { key: 'project_code', label: '归属项目', type: 'select', keepEmpty: true, default: '',
      options: () => [{ key: '', label: '全部项目（通用）' }, ...visibleProjects().map((p) => ({ key: p.code, label: `${p.code} ${p.name}` }))] },
    { key: 'note', label: '备注', type: 'textarea' },
    { key: 'sort', label: '排序', type: 'number', default: 0 },
    { key: 'color', label: '颜色', type: 'color' }, enabledForm, presetForm,
  ],
  api: { create: A.createDictItem, update: (row, d) => A.updateDictItem(row.id, d), del: (row) => A.deleteDictItem(row.id) },
}))

const customCfg = computed(() => ({
  rowKey: 'key', nameKey: 'label',
  rows: filterByArchiveProject(customFields.value), reload: async () => { customFields.value = await A.listCustomFields() },
  cols: [
    { key: 'key', label: '字段键', width: 130 }, { key: 'label', label: '列名', width: 180 },
    { key: 'module', label: '所属类型', width: 110,
      render: (row) => ({ text: row.module === 'plan' ? '项目计划' : '问题跟踪' }) },
    { key: 'type', label: '类型', width: 120, render: (row) => ({ text: { text: '单行', textarea: '多行', number: '数字', date: '日期' }[row.type] }) },
    { key: 'projects', label: '所属项目', minWidth: 180, render: (row) => ({ text: (row.projects || []).map(projectLabel).join('、') || '—' }) },
    enabledCol, presetCol,
  ],
  form: [
    { key: 'key', label: '字段键', required: true, disabled: true,
      default: `cf_${Math.max(0, ...customFields.value.map((f) => Number(String(f.key).match(/^cf_(\d+)$/)?.[1] || 0))) + 1}` },
    { key: 'label', label: '列名', required: true },
    { key: 'module', label: '所属类型', type: 'select', required: true, default: 'issue',
      options: [{ key: 'issue', label: '问题跟踪' }, { key: 'plan', label: '项目计划' }] },
    { key: 'type', label: '类型', type: 'select', required: true, default: 'text',
      options: [{ key: 'text', label: '单行' }, { key: 'textarea', label: '多行' }, { key: 'number', label: '数字' }, { key: 'date', label: '日期' }] },
    projectsFormField, enabledForm, presetForm,
  ],
  api: { create: A.createCustomField, update: (row, d) => A.updateCustomField(row.key, d), del: (row) => A.deleteCustomField(row.key) },
}))

const noticeTypeCfg = computed(() => ({
  rowKey: 'id', nameKey: 'name',
  rows: filterByArchiveProject(noticeTypes.value), reload: async () => { noticeTypes.value = await A.listNoticeTypes() },
  cols: [{ key: 'id', label: 'ID', width: 80 }, { key: 'name', label: '类型名', width: 220 },
    { key: 'projects', label: '所属项目', minWidth: 180, render: (row) => ({ text: (row.projects || []).map(projectLabel).join('、') || '—' }) },
    enabledCol, presetCol],
  form: [{ key: 'name', label: '类型名', required: true }, projectsFormField, enabledForm, presetForm],
  api: { create: A.createNoticeType, update: (row, d) => A.updateNoticeType(row.id, d), del: (row) => A.deleteNoticeType(row.id) },
}))

const todoPrioCfg = computed(() => ({
  rowKey: 'code', nameKey: 'code',
  rows: filterByArchiveProject(todoPrios.value), reload: async () => { todoPrios.value = await A.listTodoPrios() },
  cols: [{ key: 'code', label: '编码', width: 100 }, { key: 'label', label: '说明', width: 260 },
    { key: 'projects', label: '所属项目', minWidth: 180, render: (row) => ({ text: (row.projects || []).map(projectLabel).join('、') || '—' }) },
    enabledCol, presetCol],
  form: [
    { key: 'code', label: '编码', type: 'select', required: true, disabledOnEdit: true,
      options: [{ key: 'C', label: 'C 关键' }, { key: 'H', label: 'H 高' }, { key: 'M', label: 'M 中' }, { key: 'L', label: 'L 低' }] },
    { key: 'label', label: '说明' }, projectsFormField, enabledForm, presetForm,
  ],
  api: { create: A.createTodoPrio, update: (row, d) => A.updateTodoPrio(row.code, d), del: (row) => A.deleteTodoPrio(row.code) },
}))

// 各 tab 配置（解包 computed，供模板 v-for 使用）
const CFGS = computed(() => ({
  projects: projectCfg.value, products: productCfg.value, personnel: personnelCfg.value,
  dict: dictCfg.value, custom: customCfg.value, 'notice-types': noticeTypeCfg.value,
  'todo-prios': todoPrioCfg.value,
}))
const visibleCFGS = computed(() => Object.fromEntries(
  visibleTabKeys.value.filter((key) => CFGS.value[key]).map((key) => [key, CFGS.value[key]]),
))

// ---------- 项目申请审核（仅系统管理员） ----------
const reviewBusy = ref(false)
async function reviewProject(row, approve) {
  if (!currentIsSystemAdmin.value) return
  let note = ''
  if (approve) {
    try {
      await ElMessageBox.confirm(
        `确认通过项目「${row.code} ${row.name || ''}」的申请？通过后项目立即生效。`,
        '审核通过', { type: 'warning', confirmButtonText: '确认通过', cancelButtonText: '取消' },
      )
    } catch { return }
  } else {
    const res = await ElMessageBox.prompt('请填写拒绝原因（可选）', '拒绝项目申请', {
      inputType: 'textarea', inputPlaceholder: '审核意见',
      confirmButtonText: '确认拒绝', cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    }).catch(() => null)
    if (!res) return
    note = res.value || ''
  }
  reviewBusy.value = true
  try {
    await PA.reviewProjectApplication(row.code, { approve, note })
    ElMessage.success(approve ? '审核通过，项目已生效' : '已拒绝该申请')
    projects.value = await A.listProjects(true)
  } catch (e) {
    ElMessage.error(e.message || '审核失败')
  } finally {
    reviewBusy.value = false
  }
}

// ---------- 注册申请审核（项目经理或管理员） ----------
const regReviewBusy = ref(false)
async function reviewRegistration(row, approve) {
  if (!canReviewRegistration.value) return
  let note = ''
  if (approve) {
    try {
      await ElMessageBox.confirm(
        `确认通过「${row.code} ${row.name || ''}」的注册申请？通过后生成用户账号并生效。`,
        '审核通过', { type: 'warning', confirmButtonText: '确认通过', cancelButtonText: '取消' },
      )
    } catch { return }
  } else {
    const res = await ElMessageBox.prompt('请填写拒绝原因（可选）', '拒绝注册申请', {
      inputType: 'textarea', inputPlaceholder: '审核意见',
      confirmButtonText: '确认拒绝', cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    }).catch(() => null)
    if (!res) return
    note = res.value || ''
  }
  regReviewBusy.value = true
  try {
    await RA.reviewRegistration(row.code, { approve, note })
    ElMessage.success(approve ? '审核通过，用户账号已生成' : '已拒绝该注册申请')
    personnel.value = await A.listPersonnel()
  } catch (e) {
    ElMessage.error(e.message || '审核失败')
  } finally {
    regReviewBusy.value = false
  }
}

// ---------- 必填字段（按项目过滤配置） ----------
const reqDirty = ref(false)
const requiredProjectFilter = ref('')
const ruleOf = (key) => requiredFieldRules.value.find((r) => r.field_key === key)
const isGlobalRuleObj = (r) => !!r && ((r.projects || []).length === 0 || r.projects.includes('ALL'))
const isGlobalRule = (key) => isGlobalRuleObj(ruleOf(key))
// 全局视图只看全局规则；项目视图含继承的全局规则（只读）
const isRequiredForFilter = (key) => {
  const project = requiredProjectFilter.value
  if (!project) return isGlobalRule(key)
  if (isGlobalRule(key)) return true
  return (ruleOf(key)?.projects || []).includes(project)
}
const requiredRuleReadOnly = (key) => {
  if (!canWriteTab('required')) return true
  if (requiredProjectFilter.value) return isGlobalRule(key)
  return auth.scope !== null
}
const requiredReadOnlyTip = (key) => {
  if (!canWriteTab('required')) return '当前账号为只读'
  if (requiredProjectFilter.value && isGlobalRule(key)) return '全局必填字段在所有项目生效，请到全局配置中修改'
  if (!requiredProjectFilter.value && auth.scope !== null) return '全局必填字段仅系统管理员可修改'
  return ''
}
const canSaveRequired = () => canWriteTab('required') && (!!requiredProjectFilter.value || auth.scope === null)
async function onRequiredFilterChange() {
  try {
    requiredRulesByModule[reqModule.value] = await A.getRequiredFieldRules(reqModule.value)
    reqDirty.value = false
  } catch (e) {
    ElMessage.error(e.message)
  }
}
function toggleRequired(key, checked) {
  if (requiredRuleReadOnly(key)) return
  const project = requiredProjectFilter.value
  const rules = requiredFieldRules.value
  if (project) {
    const rule = ruleOf(key)
    if (checked) {
      if (!rule) rules.push({ field_key: key, projects: [project] })
      else if (!rule.projects.includes(project)) rule.projects.push(project)
    } else {
      if (!rule || isGlobalRuleObj(rule)) return
      rule.projects = rule.projects.filter((p) => p !== project)
      if (!rule.projects.length) {
        requiredRulesByModule[reqModule.value] = rules.filter((r) => r.field_key !== key)
      }
    }
  } else if (checked) {
    if (!ruleOf(key)) rules.push({ field_key: key, projects: [] })
  } else {
    requiredRulesByModule[reqModule.value] = rules.filter((r) => r.field_key !== key)
  }
  reqDirty.value = true
}
async function saveRequired() {
  try {
    const project = requiredProjectFilter.value
    if (project) {
      const payload = requiredFieldRules.value
        .filter((r) => (r.projects || []).includes(project) && !isGlobalRuleObj(r))
        .map((r) => ({ field_key: r.field_key, projects: [project] }))
      await A.putRequiredFields(payload, project, reqModule.value)
    } else {
      await A.putRequiredFields(requiredFieldRules.value.filter((r) => isGlobalRuleObj(r)), null, reqModule.value)
    }
    ElMessage.success('必填字段配置已保存')
    reqDirty.value = false
  } catch (e) {
    ElMessage.error(e.message)
  }
}

const fieldLabelOf = (key) => fieldOptions.value.find((f) => f.key === key)?.label ?? key

// 必填字段按业务类型分组展示
const REQ_GROUPS = [
  { label: '基础信息', desc: '归属项目与需求描述', color: '#409eff', keys: ['project', 'desc'] },
  { label: '分类字典', desc: '阶段、类型、模块、优先级等下拉项', color: '#67c23a',
    keys: ['stage', 'type', 'module', 'priority', 'impact', 'status', 'pending_test', 'customer_test'] },
  { label: '相关人员', desc: '提出人、负责人、开发人员', color: '#e6a23c', keys: ['reporter', 'owner', 'developer'] },
  { label: '日期时间', desc: '各业务时间节点', color: '#9b59b6',
    keys: ['reported_at', 'plan_start', 'plan_end', 'resolved_at', 'customer_test_done'] },
  { label: '方案说明', desc: '开发方案等文本', color: '#f56c6c', keys: ['solution'] },
]
const PLAN_REQ_GROUPS = [
  { label: '基础信息', desc: '项目、任务名称、分类、序号', color: '#409eff',
    keys: ['project', 'title', 'category', 'seq_no'] },
  { label: '人员与协作', desc: '负责人、配合人', color: '#67c23a',
    keys: ['owner', 'assistant1', 'assistant2'] },
  { label: '时间与进度', desc: '计划/实际时间、工时、状态', color: '#e6a23c',
    keys: ['start_date', 'end_date', 'actual_start_date', 'actual_end_date',
      'hours', 'man_days', 'adjusted_hours', 'status'] },
  { label: '金额', desc: '人天单价、计划金额与实际金额', color: '#9b59b6',
    keys: ['day_rate', 'planned_amount', 'actual_amount'] },
  { label: '其他', desc: '备注、前置任务、跟踪记录', color: '#f56c6c',
    keys: ['note', 'predecessor', 'track'] },
]
const groupedFieldOptions = computed(() => {
  const groups = (reqModule.value === 'plan' ? PLAN_REQ_GROUPS : REQ_GROUPS)
    .map((g) => ({ ...g, fields: [] }))
  const custom = { label: '自定义字段', desc: '档案中扩展的字段', color: '#1abc9c', fields: [] }
  const other = { label: '其他字段', desc: '', color: '#909399', fields: [] }
  for (const f of fieldOptions.value) {
    const g = groups.find((x) => x.keys.includes(f.key))
    if (g) g.fields.push(f)
    else if (String(f.key).startsWith('cf_')) custom.fields.push(f)
    else other.fields.push(f)
  }
  return [...groups, custom, other].filter((g) => g.fields.length)
})
const requiredCountIn = (group) => group.fields.filter((f) => isRequiredForFilter(f.key)).length
const requiredCountTotal = computed(() =>
  groupedFieldOptions.value.reduce((n, g) => n + requiredCountIn(g), 0))
watch(reqModule, () => { reqDirty.value = false })
</script>

<template>
  <div style="padding: 14px 20px 30px">
    <div class="hd">
      <BackHome />
      <h2 style="margin:0">基础档案设置</h2>
      <el-alert v-if="!canWrite" type="info" :closable="false" style="padding:4px 12px"
        title="当前账号为只读查看；如需维护档案请联系管理员" />
    </div>

    <el-tabs v-model="tab" v-loading="loading" style="margin-top:10px">
      <!-- 通用表格型档案 -->
      <el-tab-pane v-for="(c, key) in visibleCFGS" :key="key" :label="{ projects: '项目', products: '产品', personnel: '人员', dict: '字典', custom: '自定义字段', 'notice-types': '通知类型', 'todo-prios': '待办优先级' }[key]" :name="key">
        <div class="toolbar">
          <el-select v-if="key === 'dict'" v-model="dictFilter" clearable placeholder="按字典类型过滤" style="width:180px">
            <el-option v-for="d in DICT_KEYS" :key="d.key" :value="d.key" :label="d.label" />
          </el-select>
          <el-select v-if="key === 'dict'" v-model="dictProjectFilter" multiple collapse-tags clearable placeholder="按归属项目过滤" style="width:220px">
            <el-option v-for="p in visibleProjects()" :key="p.code" :value="p.code" :label="`${p.code} ${p.name}`" />
          </el-select>
          <el-select v-if="['products', 'custom', 'notice-types', 'todo-prios'].includes(key)"
            v-model="archiveProjectFilter" multiple collapse-tags clearable placeholder="按所属项目过滤" style="width:220px">
            <el-option v-for="p in visibleProjects()" :key="p.code" :value="p.code" :label="`${p.code} ${p.name}`" />
          </el-select>
          <el-button v-if="canWriteTab(key)" type="primary" size="small" @click="openDialog(c)">新增</el-button>
          <el-select v-if="key === 'personnel'" v-model="personnelProjectFilter" multiple collapse-tags clearable placeholder="按所属项目过滤" style="width:220px">
            <el-option v-for="p in visibleProjects()" :key="p.code" :value="p.code" :label="`${p.code} ${p.name}`" />
          </el-select>
          <template v-if="key === 'personnel' && canWriteTab(key)">
            <el-button size="small" :loading="exportBusy" @click="doPersonnelExport">导出 Excel</el-button>
            <el-button size="small" @click="openPersonnelImport">导入 Excel</el-button>
          </template>
        </div>
        <el-table :data="c.rows" size="small" border stripe max-height="calc(100vh - 230px)">
          <el-table-column v-for="col in c.cols" :key="col.key" :prop="col.key" :label="col.label" :width="col.width" :min-width="col.minWidth">
            <template #default="{ row }">
              <el-tag v-if="col.render && col.render(row)?.color" size="small"
                :style="{ color: col.render(row).color, borderColor: col.render(row).color, backgroundColor: col.render(row).color + '22' }">
                {{ col.render(row).text ?? row[col.key] }}
              </el-tag>
              <span v-else-if="col.render">{{ col.render(row)?.text ?? row[col.key] }}</span>
              <span v-else>{{ row[col.key] ?? '' }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="canWriteTab(key)" label="操作" :width="['projects', 'personnel'].includes(key) ? 300 : 190" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" type="primary"
                :disabled="isProtectedRow(key, row) || (['projects', 'personnel'].includes(key) && row.status && row.status !== '已生效')"
                :title="['projects', 'personnel'].includes(key) && row.status && row.status !== '已生效' ? '请先审核该申请' : ''"
                @click="openDialog(c, row)">编辑</el-button>
              <el-button link size="small" :type="row.enabled === false ? 'success' : 'warning'"
                :disabled="isProtectedRow(key, row) || (['projects', 'personnel'].includes(key) && row.status && row.status !== '已生效')"
                @click="toggleArchive(c, row)">{{ row.enabled === false ? '启用' : '禁用' }}</el-button>
              <el-button link size="small" type="danger" :disabled="isProtectedRow(key, row)"
                :title="isProtectedRow(key, row) ? '系统预置字典项不允许删除' : ''" @click="removeRow(c, row)">删除</el-button>
              <template v-if="key === 'projects' && row.status === '申请中' && currentIsSystemAdmin">
                <el-button link size="small" type="success" :loading="reviewBusy" @click="reviewProject(row, true)">通过</el-button>
                <el-button link size="small" type="danger" :disabled="reviewBusy" @click="reviewProject(row, false)">拒绝</el-button>
              </template>
              <template v-if="key === 'personnel' && row.status === '申请中' && canReviewRegistration">
                <el-button link size="small" type="success" :loading="regReviewBusy" @click="reviewRegistration(row, true)">通过</el-button>
                <el-button link size="small" type="danger" :disabled="regReviewBusy" @click="reviewRegistration(row, false)">拒绝</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 必填字段 -->
      <el-tab-pane v-if="visibleTabKeys.includes('required')" label="必填字段" name="required">
        <el-tabs v-model="reqModule" size="small" style="margin-bottom:10px">
          <el-tab-pane label="问题跟踪" name="issue" />
          <el-tab-pane label="项目计划" name="plan" />
        </el-tabs>
        <div class="toolbar">
          <el-select v-model="requiredProjectFilter" clearable placeholder="全局配置（所有项目）" style="width:220px"
            @change="onRequiredFilterChange">
            <el-option v-for="p in visibleProjects()" :key="p.code" :value="p.code" :label="`${p.code} ${p.name}`" />
          </el-select>
          <span class="tip">{{ requiredProjectFilter
            ? '当前仅配置所选项目的必填字段；标记“全局”的字段由全局配置继承'
            : '全局配置：勾选后对所有项目生效；切换项目可单独配置' }}</span>
          <el-tag size="small" type="info" effect="plain">已选 {{ requiredCountTotal }} / {{ fieldOptions.length }}</el-tag>
          <el-button v-if="canWriteTab('required')" type="primary" size="small"
            :disabled="!reqDirty || !canSaveRequired()" @click="saveRequired">保存配置</el-button>
        </div>
        <div class="req-groups">
          <section v-for="g in groupedFieldOptions" :key="g.label" class="req-group" :style="{ '--grp': g.color }">
            <header class="req-group-hd">
              <span class="req-group-bar" />
              <span class="req-group-title">{{ g.label }}</span>
              <span class="req-group-desc">{{ g.desc }}</span>
              <span class="req-group-count">{{ requiredCountIn(g) }}/{{ g.fields.length }}</span>
            </header>
            <div class="req-group-body">
              <div v-for="f in g.fields" :key="f.key" class="req-field-row">
                <el-checkbox :model-value="isRequiredForFilter(f.key)" :disabled="requiredRuleReadOnly(f.key)"
                  :title="requiredReadOnlyTip(f.key)" @change="(v) => toggleRequired(f.key, v)">
                  <span class="req-field-label">{{ f.label }}</span>
                  <span class="req-field-key">{{ f.key }}</span>
                  <el-tag v-if="requiredProjectFilter && isGlobalRule(f.key)" size="small" type="info" effect="plain">全局</el-tag>
                </el-checkbox>
              </div>
            </div>
          </section>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 通用编辑对话框 -->
    <el-dialog v-model="dialog" :title="(editing ? '编辑' : '新增') + ({ projects: '项目', products: '产品', personnel: '人员', dict: '字典项', custom: '自定义字段', 'notice-types': '通知类型', 'todo-prios': '待办优先级' }[tab] ?? '')" width="480px">
      <el-form label-width="90px">
        <template v-for="f in cfg?.form ?? []" :key="f.key">
          <el-form-item v-if="!f.showIf || f.showIf(f)" :label="f.label"
            :required="PROJECT_FIELD_KEYS.includes(f.key) ? requireArchiveProject() : (f.required && (!editing || f.requiredOnEdit))">
            <el-color-picker v-if="f.type === 'color'" v-model="form[f.key]" />
            <el-switch v-else-if="f.type === 'switch'" v-model="form[f.key]" />
            <el-input-number v-else-if="f.type === 'number'" v-model="form[f.key]" style="width:100%"
              :min="0" :precision="f.precision" :step="f.precision ? 0.5 : 1" />
            <el-select v-else-if="f.type === 'select'" v-model="form[f.key]" style="width:100%" :multiple="!!f.multiple"
              :collapse-tags="!!f.multiple" :disabled="f.disabledOnEdit && !!editing">
              <el-option v-for="o in (typeof f.options === 'function' ? f.options() : f.options)" :key="o.key" :value="o.key" :label="o.label" />
            </el-select>
            <el-input v-else-if="f.type === 'textarea'" v-model="form[f.key]" type="textarea" :rows="2" :disabled="!!f.disabled" />
            <el-input v-else v-model="form[f.key]" :disabled="!!f.disabled || (f.disabledOnEdit && !!editing)" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveDialog">保存</el-button>
      </template>
    </el-dialog>

    <!-- 人员档案 Excel 导入 -->
    <el-dialog v-model="importDialog" title="人员档案导入 Excel" width="720px" destroy-on-close>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
        title="先选择文件并确认字段对照，再导入；按人员编码新增或更新，成功后会自动下推用户" />
      <div class="toolbar">
        <input ref="personnelXlsxInput" type="file" accept=".xlsx,.xls" style="display:none" @change="pickPersonnelFile" />
        <el-button :loading="importBusy" @click="$refs.personnelXlsxInput.click()">选择 Excel 文件</el-button>
        <span v-if="importFile" class="tip">{{ importFile.name }}（{{ importHeaders.length }} 列）</span>
      </div>
      <template v-if="importHeaders.length">
        <div class="imp-title">字段对照（人员编码、姓名必填）</div>
        <el-table :data="importFieldsList" size="small" border max-height="320">
          <el-table-column label="系统字段" width="140">
            <template #default="{ row }">
              <span>{{ row.label }}</span>
              <span v-if="['code', 'name'].includes(row.key)" style="color:#e6a23c"> *</span>
            </template>
          </el-table-column>
          <el-table-column label="Excel 列">
            <template #default="{ row }">
              <el-select v-model="importMapping[row.key]" clearable filterable placeholder="不导入" style="width:100%">
                <el-option v-for="h in importHeaders" :key="h.col" :value="h.label" :label="`${h.label}（第${h.col}列）`" />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
        <div style="margin-top:12px; text-align:right">
          <el-button type="primary" :loading="importBusy" @click="doPersonnelImport">开始导入</el-button>
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
  </div>
</template>

<style scoped>
.hd { display: flex; align-items: center; gap: 16px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.tip { font-size: 12px; color: var(--el-text-color-secondary); }
.imp-title { font-weight: 600; margin: 6px 0 8px; }
.imp-errors { margin-top: 10px; padding: 8px 10px; background: var(--el-fill-color-light); font-size: 12px; line-height: 1.8; }
/* 必填字段：按类型分组卡片 */
.req-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
.req-group { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; overflow: hidden; background: var(--el-bg-color); }
.req-group-hd { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: var(--el-fill-color-light); }
.req-group-bar { width: 4px; height: 15px; border-radius: 2px; background: var(--grp); flex: none; }
.req-group-title { font-weight: 600; font-size: 14px; }
.req-group-desc { font-size: 12px; color: var(--el-text-color-secondary); flex: 1; }
.req-group-count { font-size: 12px; color: var(--el-text-color-secondary); }
.req-group-body { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
.req-group-body .el-checkbox { margin-right: 0; height: 24px; }
.req-field-row { display: flex; align-items: center; gap: 12px; }
.req-field-row > .el-checkbox { flex: none; min-width: 160px; }
.req-field-projects { flex: 1; }
.req-field-label { font-size: 13px; }
.req-field-key { margin-left: 6px; font-size: 11px; color: var(--el-text-color-placeholder); font-family: monospace; }
</style>
