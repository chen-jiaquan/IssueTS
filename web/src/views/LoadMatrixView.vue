<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import http from '@/api/http'
import { getLoadMatrix } from '@/api/stats'
const pad = (n) => String(n).padStart(2, '0')
const monthStart = (offset = 0) => {
  const d = new Date()
  const m = d.getMonth() + offset
  return `${d.getFullYear() + Math.floor(m / 12)}-${pad((m % 12) + 1)}-01`
}
const monthEnd = (offset = 0) => {
  const d = new Date()
  const m = d.getMonth() + offset
  const y = d.getFullYear() + Math.floor(m / 12)
  const mm = (m % 12) + 1
  return `${y}-${pad(mm)}-${pad(new Date(y, mm, 0).getDate())}`
}
const q = reactive({ from: monthStart(0), to: monthEnd(4), granularity: 'month', project: '' })
const range = ref([q.from, q.to])
const data = ref(null)
const loading = ref(false)
const projectOptions = ref([])

const granLabel = computed(() => ({ day: '日', week: '周', month: '月' })[q.granularity] || '月')
const colLabel = (key) => (q.granularity === 'week' ? `${key} 起` : key)

function cellClass(cell) {
  if (!cell || !cell.hours) return 'lv-none'
  if (cell.rate < 80) return 'lv-low'
  if (cell.rate <= 100) return 'lv-mid'
  if (cell.rate <= 150) return 'lv-high'
  return 'lv-over'
}
function cellText(cell) {
  if (!cell || !cell.hours) return '—'
  return `${cell.hours}h · ${cell.rate}%`
}

async function load() {
  if (!Array.isArray(range.value) || range.value.length !== 2) {
    return ElMessage.warning('请选择统计周期')
  }
  q.from = range.value[0]
  q.to = range.value[1]
  loading.value = true
  try {
    data.value = await getLoadMatrix({ ...q })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const cfg = await http.get('/config/fields', { params: { scope: 1 } })
    projectOptions.value = (cfg.projects || []).map((p) => ({ code: p.code, name: p.name || p.code }))
  } catch { /* 项目下拉失败不影响查询 */ }
  load()
})
</script>

<template>
  <div class="load-page" v-loading="loading">
    <div class="topbar">
      <BackHome />
      <span class="brand">人员负载矩阵</span>
      <span class="ops-label">周期</span>
      <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD"
        start-placeholder="开始日期" end-placeholder="结束日期" style="width: 250px" />
      <span class="ops-label">粒度</span>
      <el-radio-group v-model="q.granularity" @change="load">
        <el-radio-button value="day">日</el-radio-button>
        <el-radio-button value="week">周</el-radio-button>
        <el-radio-button value="month">月</el-radio-button>
      </el-radio-group>
      <el-select v-model="q.project" clearable placeholder="全部项目" style="width: 180px" @change="load">
        <el-option v-for="p in projectOptions" :key="p.code" :value="p.code" :label="p.name" />
      </el-select>
      <div class="ops">
        <el-button type="primary" size="small" @click="load">查询</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <template #header>
        <div class="hd">
          <span>人 × {{ granLabel }}负载矩阵 · 格内为工时 / 利用率（按工作日产能）</span>
          <span v-if="data" class="hint">{{ data.from }} ~ {{ data.to }} · 共 {{ data.persons.length }} 人</span>
        </div>
      </template>

      <div v-if="data" class="matrix-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th class="row-hd">人员</th>
              <th v-for="c in data.cols" :key="c">{{ colLabel(c) }}</th>
              <th class="sum">合计</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="person in data.persons" :key="person">
              <td class="row-hd">{{ person }}</td>
              <td v-for="c in data.cols" :key="c" :class="cellClass(data.matrix[person][c])">
                {{ cellText(data.matrix[person][c]) }}
              </td>
              <td class="sum num">{{ data.rowTotals[person] }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="row-hd">合计</td>
              <td v-for="c in data.cols" :key="c" class="num">{{ data.colTotals[c] }}</td>
              <td class="sum num">{{ data.grandTotal }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div v-else class="empty">暂无数据</div>

      <div class="legend">
        <span><i class="lv-low"></i>低于 80%</span>
        <span><i class="lv-mid"></i>80-100%</span>
        <span><i class="lv-high"></i>超 100-150%</span>
        <span><i class="lv-over"></i>严重超 150%</span>
        <span><i class="lv-none"></i>无排工</span>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.load-page { padding: 12px; }
.topbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.brand { font-size: 18px; font-weight: 700; }
.ops { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; align-items: center; }
.ops-label { font-size: 12px; color: var(--el-text-color-secondary); }
.hd { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.hint { font-size: 12px; color: var(--el-text-color-secondary); }
.empty { color: var(--el-text-color-disabled); font-size: 13px; padding: 16px 0; }
.matrix-wrap { overflow: auto; max-height: calc(100vh - 260px); border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.matrix {
  --matrix-head-bg: #e8f4ff;
  --matrix-label-bg: #f2f7fd;
  --matrix-total-bg: #dcebf9;
  --matrix-head-color: #3c5a75;
  border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px;
}
.matrix th, .matrix td { border-right: 1px solid var(--el-border-color-lighter); border-bottom: 1px solid var(--el-border-color-lighter); padding: 7px 10px; text-align: center; white-space: nowrap; }
.matrix thead th { background: var(--matrix-head-bg); color: var(--matrix-head-color); position: sticky; top: 0; z-index: 3; }
.matrix .row-hd { position: sticky; left: 0; z-index: 2; background: var(--matrix-label-bg); color: var(--matrix-head-color); text-align: left; font-weight: 600; min-width: 90px; }
.matrix thead .row-hd { z-index: 4; }
.matrix tfoot td { background: var(--matrix-head-bg); color: var(--matrix-head-color); font-weight: 600; }
.matrix .sum { background: var(--matrix-total-bg); color: var(--matrix-head-color); }
.matrix .num { font-variant-numeric: tabular-nums; }
.matrix td.lv-low { background: #e8f4ff; color: #1f6feb; }
.matrix td.lv-mid { background: #fff4d6; color: #9a6700; }
.matrix td.lv-high { background: #ffe0b2; color: #a34e00; }
.matrix td.lv-over { background: #ffd6d6; color: #b42318; }
.matrix td.lv-none { background: #edf7f4; color: #5a9b8f; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; font-size: 12px; color: var(--el-text-color-secondary); }
.legend i { display: inline-block; width: 12px; height: 12px; margin-right: 5px; vertical-align: -2px; border-radius: 2px; }
.legend i.lv-low { background: #e8f4ff; }
.legend i.lv-mid { background: #fff4d6; }
.legend i.lv-high { background: #ffe0b2; }
.legend i.lv-over { background: #ffd6d6; }
.legend i.lv-none { background: #edf7f4; border: 1px solid #a8d5cc; }
</style>
