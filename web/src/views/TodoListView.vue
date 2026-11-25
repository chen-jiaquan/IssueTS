<script setup>
// 待办聚合清单：问题 + 项目计划 + 手工待办，按待办类型分类展示
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import MultiCheckboxSelect from '@/components/MultiCheckboxSelect.vue'
import http from '@/api/http'
import { useAuthStore } from '@/store/auth'
import { listPlans } from '@/api/projectPlans'
import { listAggregatedTodos, listTodos, updateTodo } from '@/api/home'

const router = useRouter()
const auth = useAuthStore()
const TYPES = ['问题', '计划', '手工']
const PRIO_LABEL = { C: '关键', H: '高', M: '中', L: '低' }
const SOURCE_LABEL = { issue: '问题清单', plan: '项目计划', todo: '手工待办' }

const rows = ref([])
const todos = ref([])
const loading = ref(false)
const activeType = ref('全部')
const owner = ref('')
const project = ref('')
const owners = ref([])
const projectOptions = ref([])
const todoTypes = ref([...TYPES])
const editDialog = ref(false)
const editForm = reactive({ text: '', projects: [], owner: '', start_date: '', due: '', prio: 'M', type: '手工', done: false })
let editingRef = null

function fmtDate(v) {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const isDoneManual = (r) => r.source === 'todo' && r.status === '关闭'
// 待办列表不展示已完成的手工待办（首页手工页签不受此限制）
const allRows = computed(() => rows.value.filter((r) => !isDoneManual(r)))
const counts = computed(() => {
  const c = { 全部: allRows.value.length, 问题: 0, 计划: 0, 手工: 0 }
  for (const r of allRows.value) if (c[r.type] !== undefined) c[r.type] += 1
  return c
})
const visibleRows = computed(() => activeType.value === '全部'
  ? allRows.value
  : allRows.value.filter((r) => r.type === activeType.value))
const isOverdue = (r) => r.due_date && new Date(fmtDate(r.due_date)) < new Date(new Date().toDateString())
const EMPTY_FILTER = '__EMPTY__'
const isEmptyValue = (v) => v === null || v === undefined || v === ''
const fieldValue = {
  type: (r) => r.type || null,
  refNo: (r) => r.ref_no || '—',
  source: (r) => (r.source ? (SOURCE_LABEL[r.source] || r.source) : null),
  title: (r) => r.title || null,
  owner: (r) => r.owner || null,
  project: (r) => (r.projects || []).join('、') || '全员',
  startDate: (r) => fmtDate(r.start_date) || '—',
  dueDate: (r) => fmtDate(r.due_date) || '—',
  status: (r) => r.status || null,
}
// 列筛选项只从当前列表数据中提取；空值作为「（空）」选项排在最后
const columnFilters = computed(() => Object.fromEntries(Object.entries(fieldValue).map(([key, get]) => {
  const values = visibleRows.value.map(get)
  const options = [...new Set(values.filter((v) => !isEmptyValue(v)))]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((value) => ({ text: String(value), value }))
  if (values.some(isEmptyValue)) options.push({ text: '（空）', value: EMPTY_FILTER })
  return [key, options]
})))
const filterBy = (key) => (value, row) => {
  const raw = fieldValue[key](row)
  const selected = Array.isArray(value) ? value : [value]
  return selected.some((v) => v === EMPTY_FILTER
    ? isEmptyValue(raw)
    : String(raw) === String(v))
}

async function load() {
  loading.value = true
  try {
    const params = {}
    if (owner.value) params.owner = owner.value
    if (project.value) params.project = project.value
    const [agg, manual, plans] = await Promise.all([
      listAggregatedTodos(params), listTodos(), listPlans({}).catch(() => []),
    ])
    // 计划类型的待办只保留末级任务：有下级的汇总任务由下级任务体现
    const parentIds = new Set((Array.isArray(plans) ? plans : []).filter((p) => p.parent_id).map((p) => p.parent_id))
    rows.value = agg.filter((r) => r.source !== 'plan' || !parentIds.has(r.ref))
    todos.value = manual
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
function openRow(row) {
  if (row.source === 'issue') {
    router.push({
      path: '/issues',
      query: { seq: row.ref_no, project: row.projects?.[0] || '', locate: '1' },
    })
  } else if (row.source === 'plan') {
    router.push({ path: '/plan', query: { project: row.projects?.[0] || '', wbs: row.ref_no, id: row.ref } })
  }
}
function openEdit(row) {
  const t = todos.value.find((x) => x.id === row.ref)
  if (!t) return ElMessage.warning('未找到该手工待办')
  editingRef = t.id
  Object.assign(editForm, {
    text: t.text, projects: t.projects || [], owner: t.owner || '',
    start_date: fmtDate(t.start_date), due: fmtDate(t.due),
    prio: t.prio || 'M', type: t.type || '手工', done: !!t.done,
  })
  editDialog.value = true
}
async function saveEdit() {
  if (!editForm.text.trim()) return ElMessage.warning('内容必填')
  await updateTodo(editingRef, {
    ...editForm,
    start_date: editForm.start_date || null,
    due: editForm.due || null,
  })
  ElMessage.success('已保存')
  editDialog.value = false
  load()
}
onMounted(async () => {
  await load()
  try {
    const cfg = await http.get('/config/fields', { params: { scope: 1 } })
    owners.value = [...new Set((cfg.personnel || []).map((p) => p.name).filter(Boolean))]
    projectOptions.value = (cfg.projects || []).map((p) => ({ value: p.code, label: p.name || p.code }))
    const dictTypes = (cfg.dicts?.todo_type || []).filter((t) => t.enabled !== false).map((t) => t.value)
    if (dictTypes.length) todoTypes.value = dictTypes
  } catch { /* 筛选选项加载失败不影响清单 */ }
})
</script>

<template>
  <div class="todo-center" v-loading="loading">
    <div class="toolbar">
      <BackHome />
      <span class="title">待办聚合清单</span>
      <el-select v-model="project" clearable filterable placeholder="按项目筛选" style="width: 160px" @change="load">
        <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
      </el-select>
      <el-select v-if="auth.has('PROJECT_ALL')" v-model="owner" clearable filterable placeholder="按负责人筛选" style="width: 150px" @change="load">
        <el-option v-for="o in owners" :key="o" :value="o" :label="o" />
      </el-select>
      <el-button size="small" @click="load">刷新</el-button>
      <span class="hint">截止日期不晚于未来一周（含逾期），且未完成</span>
    </div>

    <el-card shadow="never">
      <el-tabs v-model="activeType">
        <el-tab-pane v-for="t in ['全部', ...TYPES]" :key="t" :name="t">
          <template #label>{{ t }}（{{ counts[t] }}）</template>
        </el-tab-pane>
      </el-tabs>
      <el-table :data="visibleRows" size="small" stripe border max-height="calc(100vh - 250px)">
        <el-table-column label="待办类型" width="88" column-key="type" :filters="columnFilters.type" :filter-method="filterBy('type')">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.type }}</el-tag></template>
        </el-table-column>
        <el-table-column label="编号" width="88" column-key="refNo" :filters="columnFilters.refNo" :filter-method="filterBy('refNo')">
          <template #default="{ row }">{{ row.ref_no || '—' }}</template>
        </el-table-column>
        <el-table-column label="来源" width="96" column-key="source" :filters="columnFilters.source" :filter-method="filterBy('source')">
          <template #default="{ row }">{{ SOURCE_LABEL[row.source] || row.source }}</template>
        </el-table-column>
        <el-table-column label="事项" min-width="240" show-overflow-tooltip prop="title" column-key="title" :filters="columnFilters.title" :filter-method="filterBy('title')" />
        <el-table-column label="负责人" width="104" prop="owner" column-key="owner" :filters="columnFilters.owner" :filter-method="filterBy('owner')" />
        <el-table-column label="项目" width="120" column-key="project" :filters="columnFilters.project" :filter-method="filterBy('project')">
          <template #default="{ row }">{{ (row.projects || []).join('、') || '全员' }}</template>
        </el-table-column>
        <el-table-column label="开始时间" width="110" column-key="startDate" :filters="columnFilters.startDate" :filter-method="filterBy('startDate')">
          <template #default="{ row }">{{ fmtDate(row.start_date) || '—' }}</template>
        </el-table-column>
        <el-table-column label="截止日期" width="110" column-key="dueDate" :filters="columnFilters.dueDate" :filter-method="filterBy('dueDate')">
          <template #default="{ row }">
            <span :class="{ overdue: isOverdue(row) }">{{ fmtDate(row.due_date) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96" prop="status" column-key="status" :filters="columnFilters.status" :filter-method="filterBy('status')" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.source !== 'todo' && auth.has('ISSUE_VIEW')" link size="small" @click="openRow(row)">查看</el-button>
            <el-button v-else-if="row.source === 'todo' && auth.has('DASH_TODO')" link size="small" @click="openEdit(row)">编辑</el-button>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <template #empty>暂无符合条件的待办事项</template>
      </el-table>
    </el-card>

    <el-dialog v-model="editDialog" title="编辑手工待办" width="500px">
      <el-form :model="editForm" label-width="80px">
        <el-form-item label="内容" required><el-input v-model="editForm.text" maxlength="512" /></el-form-item>
        <el-form-item label="项目">
          <MultiCheckboxSelect v-model="editForm.projects" :options="projectOptions" placeholder="可多选，留空则全员可见" filterable />
        </el-form-item>
        <el-form-item label="负责人"><el-input v-model="editForm.owner" /></el-form-item>
        <el-form-item label="开始日期"><el-date-picker v-model="editForm.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="待办类型">
          <el-select v-model="editForm.type" style="width:100%">
            <el-option v-for="t in todoTypes" :key="t" :value="t" :label="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="截止"><el-date-picker v-model="editForm.due" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="editForm.prio" style="width:100%">
            <el-option v-for="(label, key) in PRIO_LABEL" :key="key" :value="key" :label="`${key} ${label}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="已完成"><el-switch v-model="editForm.done" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.todo-center { padding: 14px 20px 30px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.title { font-size: 18px; font-weight: 600; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; margin-left: auto; }
.overdue { color: var(--el-color-danger); font-weight: 600; }
:deep(.el-table__body tr.locate-row > td.el-table__cell) { background: color-mix(in srgb, var(--el-color-warning) 24%, var(--el-bg-color)) !important; }
</style>
