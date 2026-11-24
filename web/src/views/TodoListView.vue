<script setup>
// 待办聚合清单：问题 + 项目计划 + 手工待办，按待办类型分类展示
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import http from '@/api/http'
import { listAggregatedTodos } from '@/api/home'

const router = useRouter()
const TYPES = ['问题', '计划', '手工']
const rows = ref([])
const loading = ref(false)
const activeType = ref('全部')
const owner = ref('')
const owners = ref([])

function fmtDate(v) {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const counts = computed(() => {
  const c = { 全部: rows.value.length, 问题: 0, 计划: 0, 手工: 0 }
  for (const r of rows.value) if (c[r.type] !== undefined) c[r.type] += 1
  return c
})
const visibleRows = computed(() => activeType.value === '全部'
  ? rows.value
  : rows.value.filter((r) => r.type === activeType.value))

const SOURCE_LABEL = { issue: '问题清单', plan: '项目计划', todo: '手工待办' }
const isOverdue = (r) => r.due_date && new Date(fmtDate(r.due_date)) < new Date(new Date().toDateString())

async function load() {
  loading.value = true
  try {
    const params = {}
    if (owner.value) params.owner = owner.value
    rows.value = await listAggregatedTodos(params)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
function openRow(row) {
  if (row.source === 'issue') router.push('/issues')
  else if (row.source === 'plan') router.push('/plan')
}
onMounted(async () => {
  await load()
  try {
    const cfg = await http.get('/config/fields')
    owners.value = [...new Set((cfg.personnel || []).map((p) => p.name).filter(Boolean))]
  } catch { /* 负责人选项加载失败不影响清单 */ }
})
</script>

<template>
  <div class="todo-center" v-loading="loading">
    <div class="toolbar">
      <BackHome />
      <span class="title">待办聚合清单</span>
      <el-select v-model="owner" clearable filterable placeholder="按负责人筛选" style="width: 160px" @change="load">
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
        <el-table-column label="待办类型" width="90">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.type }}</el-tag></template>
        </el-table-column>
        <el-table-column label="来源" width="100">
          <template #default="{ row }">{{ SOURCE_LABEL[row.source] || row.source }}</template>
        </el-table-column>
        <el-table-column label="事项" min-width="260" show-overflow-tooltip prop="title" />
        <el-table-column label="负责人" width="110" prop="owner" />
        <el-table-column label="项目" width="120">
          <template #default="{ row }">{{ (row.projects || []).join('、') || '全员' }}</template>
        </el-table-column>
        <el-table-column label="截止日期" width="110">
          <template #default="{ row }">
            <span :class="{ overdue: isOverdue(row) }">{{ fmtDate(row.due_date) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" prop="status" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.source !== 'todo'" link size="small" @click="openRow(row)">查看</el-button>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <template #empty>暂无符合条件的待办事项</template>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.todo-center { padding: 14px 20px 30px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.title { font-size: 18px; font-weight: 600; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; margin-left: auto; }
.overdue { color: var(--el-color-danger); font-weight: 600; }
</style>
