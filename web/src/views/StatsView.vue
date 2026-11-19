<script setup>
// 统计报表：行维度 × 时间桶透视，支持人员口径/粒度/状态过滤/导出
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import http from '@/api/http'
import { getPivot, exportPivot } from '@/api/stats'
import { useAuthStore } from '@/store/auth'

const router = useRouter()
const auth = useAuthStore()

const DIMS = [
  { key: 'owner', label: '负责人', person: true },
  { key: 'project', label: '项目' },
  { key: 'status', label: '状态' },
  { key: 'module', label: '模块' },
  { key: 'priority', label: '优先级' },
  { key: 'type', label: '类型' },
]
const GRANS = [{ key: 'day', label: '日' }, { key: 'week', label: '周' }, { key: 'month', label: '月' }]

const q = reactive({ dim: 'owner', personField: 'owner', timeField: 'planEnd', granularity: 'month', status: [] })
const data = ref(null)
const loading = ref(false)
const statusOptions = ref([])

const curDim = computed(() => DIMS.find((d) => d.key === q.dim))
const dimLabel = computed(() => (q.dim === 'owner'
  ? (q.personField === 'developer' ? '开发人员' : '负责人')
  : curDim.value?.label ?? ''))

const params = () => {
  const p = { dim: q.dim, timeField: q.timeField, granularity: q.granularity }
  if (q.dim === 'owner') p.personField = q.personField
  if (q.status.length) p.status = q.status.join(',')
  return p
}

// 列标签（与原型一致：周=MM-DD周，月=YYYY-MM月，日=MM-DD）
const colLabel = (c) => {
  if (c === '（空）') return c
  if (q.granularity === 'month') return c + '月'
  if (q.granularity === 'week') return c.slice(5) + '周'
  return c.slice(5)
}

async function load() {
  loading.value = true
  try {
    data.value = await getPivot(params())
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function doExport() {
  const blob = await exportPivot(params())
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `统计透视-${dimLabel.value}-${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}

// 点击行 → 带筛选跳转问题列表
const rowQueryKey = computed(() => (q.dim === 'owner' ? q.personField : q.dim))
function drillRow(row) {
  if (row === '（空）') return
  router.push({ path: '/issues', query: { [rowQueryKey.value]: row } })
}

onMounted(async () => {
  try {
    const cfg = await http.get('/config/fields')
    statusOptions.value = (cfg.dicts.status || []).map((d) => d.value)
  } catch { /* 状态下拉失败不影响透视 */ }
  load()
})
</script>

<template>
  <div style="padding: 14px 20px 30px">
    <div class="toolbar">
      <BackHome />
      <el-select v-model="q.dim" style="width: 130px" @change="load">
        <el-option v-for="d in DIMS" :key="d.key" :value="d.key" :label="d.label" />
      </el-select>
      <el-select v-if="q.dim === 'owner'" v-model="q.personField" style="width: 120px" @change="load">
        <el-option value="owner" label="按负责人" />
        <el-option value="developer" label="按开发人员" />
      </el-select>
      <el-select v-model="q.timeField" style="width: 120px" @change="load">
        <el-option value="planEnd" label="预计完成" />
        <el-option value="resolvedAt" label="实际完成" />
      </el-select>
      <el-radio-group v-model="q.granularity" size="small" @change="load">
        <el-radio-button v-for="g in GRANS" :key="g.key" :value="g.key">{{ g.label }}</el-radio-button>
      </el-radio-group>
      <el-select v-model="q.status" multiple collapse-tags clearable placeholder="状态过滤" style="width: 180px" @change="load">
        <el-option v-for="s in statusOptions" :key="s" :value="s" :label="s" />
      </el-select>
      <el-button :disabled="!auth.has('DATA_EXPORT')" @click="doExport">导出 Excel</el-button>
    </div>

    <el-card v-loading="loading" shadow="never">
      <template #header>
        <div class="hd">
          <span>{{ dimLabel }} × {{ q.timeField === 'planEnd' ? '预计完成' : '实际完成' }}（{{ GRANS.find(g => g.key === q.granularity).label }}）</span>
          <span class="tot">合计 <b>{{ data?.grandTotal ?? 0 }}</b> 条</span>
        </div>
      </template>
      <table v-if="data" class="pivot">
        <thead>
          <tr>
            <th class="row-hd">{{ dimLabel }}</th>
            <th v-for="c in data.cols" :key="c">{{ colLabel(c) }}</th>
            <th class="sum">合计</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in data.rows" :key="r">
            <td class="row-hd link" @click="drillRow(r)">{{ r }}</td>
            <td v-for="c in data.cols" :key="c" :class="{ zero: !data.matrix[r][c] }">{{ data.matrix[r][c] || '-' }}</td>
            <td class="sum">{{ data.rowTotals[r] }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="row-hd">合计</td>
            <td v-for="c in data.cols" :key="c">{{ data.colTotals[c] || 0 }}</td>
            <td class="sum">{{ data.grandTotal }}</td>
          </tr>
        </tfoot>
      </table>
      <el-empty v-else description="暂无数据" />
    </el-card>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
.hd { display: flex; justify-content: space-between; align-items: center; }
.tot b { color: var(--el-color-primary); }
.pivot { width: 100%; border-collapse: collapse; font-size: 13px; }
.pivot th, .pivot td { border: 1px solid var(--el-border-color-lighter); padding: 6px 10px; text-align: center; }
.pivot th { background: var(--el-fill-color-light); font-weight: 600; }
.pivot .row-hd { text-align: left; font-weight: 500; }
.pivot .row-hd.link { color: var(--el-color-primary); cursor: pointer; }
.pivot .zero { color: var(--el-text-color-disabled); }
.pivot .sum { background: var(--el-fill-color-lighter); font-weight: 600; }
</style>
