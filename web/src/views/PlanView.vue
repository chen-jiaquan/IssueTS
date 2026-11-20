<script setup>
// 项目计划：编写计划、Excel 导入；父级时间/工时由下级自动汇总
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import MultiCheckboxSelect from '@/components/MultiCheckboxSelect.vue'
import { useAuthStore } from '@/store/auth'
import http from '@/api/http'
import {
  listPlans, createPlan, updatePlan, deletePlan, importPlans, downloadPlanTemplate,
} from '@/api/projectPlans'

const auth = useAuthStore()
const filter = reactive({ project: [] })
const projectMeta = ref([])
const plans = ref([])
const loading = ref(false)
const dialog = ref(false)
const editing = ref(null)
const fileInput = ref(null)
const form = reactive({
  project: '', parent_id: '', title: '', owner: '',
  start_date: '', end_date: '', hours: 0, sort: 0, note: '',
})

const projectOptions = computed(() => projectMeta.value.map((p) => ({ value: p.code, label: p.name || p.code })))
const rolledUp = computed(() => !!editing.value?.has_children)
const isDesc = (candidateId, ancestorId) => {
  if (!ancestorId) return false
  const byId = Object.fromEntries(plans.value.map((p) => [p.id, p]))
  let cur = byId[candidateId]
  const seen = new Set()
  while (cur?.parent_id && !seen.has(cur.id)) {
    if (cur.parent_id === ancestorId) return true
    seen.add(cur.id)
    cur = byId[cur.parent_id]
  }
  return false
}
const parentOptions = computed(() => plans.value.filter((p) =>
  p.project === form.project && p.id !== editing.value?.id && !isDesc(p.id, editing.value?.id)))
const treeRows = computed(() => {
  const byParent = new Map()
  for (const p of plans.value) {
    const key = p.parent_id || '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(p)
  }
  const out = []
  const walk = (key, depth) => {
    for (const row of byParent.get(key) || []) {
      out.push({ ...row, depth })
      walk(row.id, depth + 1)
    }
  }
  walk('__root__', 0)
  return out
})
const totalHours = computed(() => plans.value.filter((p) => !p.parent_id)
  .reduce((sum, p) => sum + Number(p.hours || 0), 0))

async function loadMeta() {
  try {
    const cfg = await http.get('/config/fields', { params: { scope: 1 } })
    projectMeta.value = cfg.projects || []
  } catch (e) { ElMessage.error(e.message) }
}
async function load() {
  loading.value = true
  try {
    const params = filter.project.length ? { project: filter.project.join(',') } : {}
    plans.value = await listPlans(params)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
function openForm(row = null) {
  editing.value = row
  Object.assign(form, row ? {
    project: row.project, parent_id: row.parent_id || '', title: row.title, owner: row.owner || '',
    start_date: row.start_date || '', end_date: row.end_date || '', hours: Number(row.hours || 0),
    sort: Number(row.sort || 0), note: row.note || '',
  } : {
    project: filter.project[0] || '', parent_id: '', title: '', owner: '',
    start_date: '', end_date: '', hours: 0, sort: 0, note: '',
  })
  dialog.value = true
}
async function save() {
  if (!form.project) return ElMessage.warning('请选择项目')
  if (!form.title.trim()) return ElMessage.warning('计划名称必填')
  const payload = {
    ...form, parent_id: form.parent_id || null,
    hours: Number(form.hours) || 0, sort: Number(form.sort) || 0,
  }
  try {
    if (editing.value) await updatePlan(editing.value.id, payload)
    else await createPlan(payload)
    ElMessage.success('已保存')
    dialog.value = false
    load()
  } catch (e) { ElMessage.error(e.message) }
}
async function remove(row) {
  try {
    await ElMessageBox.confirm(`删除「${row.title}」及其所有下级计划？`, '确认删除', { type: 'warning' })
    await deletePlan(row.id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message)
  }
}
async function onFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const result = await importPlans(file)
    ElMessage.success(`成功导入 ${result.imported} 条计划`)
    if (result.errors?.length) {
      await ElMessageBox.alert(result.errors.join('\n'), '部分行未导入', { type: 'warning' })
    }
    e.target.value = ''
    load()
  } catch (err) { ElMessage.error(err.message) }
}
async function downloadTemplate() {
  try { await downloadPlanTemplate() } catch (e) { ElMessage.error(e.message) }
}
onMounted(async () => {
  await loadMeta()
  load()
})
</script>

<template>
  <div class="plan-page">
    <div class="topbar">
      <BackHome />
      <span class="brand">项目计划</span>
      <MultiCheckboxSelect v-model="filter.project" :options="projectOptions" width="240px"
        placeholder="全部项目" filterable @change="load" />
      <div class="ops">
        <el-button v-if="auth.has('ISSUE_CREATE')" type="primary" size="small" @click="openForm()">新增计划</el-button>
        <template v-if="auth.has('ISSUE_IMPORT')">
          <el-button size="small" @click="fileInput.click()">导入 Excel</el-button>
          <el-button size="small" @click="downloadTemplate">下载模板</el-button>
          <input ref="fileInput" type="file" accept=".xlsx,.xls" hidden @change="onFile" />
        </template>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="num">{{ plans.length }}</div><div class="lbl">计划条目</div></div>
      <div class="kpi"><div class="num">{{ plans.filter((p) => !p.parent_id).length }}</div><div class="lbl">顶层计划</div></div>
      <div class="kpi"><div class="num">{{ totalHours }}</div><div class="lbl">总工时（h）</div></div>
    </div>

    <el-card shadow="never" v-loading="loading">
      <template #header>
        <div class="hd">
          <span>计划清单</span>
          <span class="hint">有下级的计划，其开始/结束时间和工时由下级自动汇总</span>
        </div>
      </template>
      <el-table :data="treeRows" row-key="id" border size="small" default-expand-all>
        <el-table-column label="计划名称" min-width="280">
          <template #default="{ row }">
            <span :style="{ paddingLeft: `${row.depth * 18}px` }">{{ row.title }}</span>
            <el-tag v-if="row.has_children" size="small" effect="plain" style="margin-left: 6px">汇总</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="project" label="项目" width="110" />
        <el-table-column prop="owner" label="负责人" width="110" />
        <el-table-column prop="start_date" label="开始" width="110" />
        <el-table-column prop="end_date" label="结束" width="110" />
        <el-table-column prop="hours" label="工时" width="90" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button v-if="auth.has('ISSUE_CREATE')" link size="small" @click="openForm(row)">编辑</el-button>
            <el-button v-if="auth.has('ISSUE_CREATE')" link size="small" type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!treeRows.length" class="empty">暂无计划，点击「新增计划」或「导入 Excel」开始编写</div>
    </el-card>

    <el-dialog v-model="dialog" :title="editing ? '编辑计划' : '新增计划'" width="560px" top="5vh">
      <el-form :model="form" label-width="90px">
        <el-form-item label="项目" required>
          <el-select v-model="form.project" placeholder="请选择项目" style="width:100%" :disabled="!!editing">
            <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="上级计划">
          <el-select v-model="form.parent_id" clearable placeholder="无（顶层计划）" style="width:100%">
            <el-option v-for="p in parentOptions" :key="p.id" :value="p.id" :label="p.title" />
          </el-select>
        </el-form-item>
        <el-form-item label="计划名称" required><el-input v-model="form.title" maxlength="255" /></el-form-item>
        <el-form-item label="负责人"><el-input v-model="form.owner" /></el-form-item>
        <el-form-item label="开始日期">
          <el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%" :disabled="rolledUp" />
        </el-form-item>
        <el-form-item label="结束日期">
          <el-date-picker v-model="form.end_date" type="date" value-format="YYYY-MM-DD" style="width:100%" :disabled="rolledUp" />
        </el-form-item>
        <el-form-item label="工时">
          <el-input-number v-model="form.hours" :min="0" :step="1" style="width:100%" :disabled="rolledUp" />
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" style="width:100%" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
        <div v-if="rolledUp" class="hint">该计划有下级，时间/工时由下级自动汇总，无需手动填写。</div>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button v-if="auth.has('ISSUE_CREATE')" type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.plan-page { padding: 12px; }
.topbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.brand { font-size: 18px; font-weight: 700; }
.ops { display: flex; gap: 6px; margin-left: auto; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px; }
.kpi { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 14px 16px; }
.kpi .num { font-size: 26px; font-weight: 700; color: var(--el-color-primary); }
.kpi .lbl { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; }
.hd { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.hint { font-size: 12px; color: var(--el-text-color-secondary); }
.empty { color: var(--el-text-color-disabled); font-size: 13px; padding: 16px 0; }
</style>
