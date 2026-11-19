<script setup>
// 统计报表：行维度 × 时间桶透视，支持人员口径/粒度/项目/状态/期间过滤/导出
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

const q = reactive({ dim: 'owner', personField: 'owner', timeField: 'planEnd', granularity: 'month', project: [], stage: [], status: ['未开始', '进行中'], dateFrom: '', dateTo: '' })
const data = ref(null)
const loading = ref(false)
const projectOptions = ref([])
const stageDicts = ref([]) // 阶段字典原始项（含 project_code），用于按项目联动过滤
const statusOptions = ref([])
// 阶段选项：归属项目为空（通用）始终可选；专属阶段仅在已选项目包含其归属项目时可选
const stageOptions = computed(() => stageDicts.value
  .filter((d) => !d.project_code || q.project.includes(d.project_code))
  .map((d) => d.value))
// 项目变化：先清掉不再可选的阶段项，再刷新报表（避免用失效阶段条件统计）
function onProjectChange() {
  const allowed = stageOptions.value
  q.stage = q.stage.filter((s) => allowed.includes(s))
  load()
}
// 表格锁定：'' 不锁定 / 'header' 仅锁定表头 / 'both' 表头+行维度列与合计列固定（偏好存本地）
const lockMode = ref(localStorage.getItem('stats_lock_mode') ?? '')
const TABLE_MAX_HEIGHT = 'calc(100vh - 180px)'
function setLockMode(val) { localStorage.setItem('stats_lock_mode', val ?? '') }

const curDim = computed(() => DIMS.find((d) => d.key === q.dim))
const dimLabel = computed(() => (q.dim === 'owner'
  ? (q.personField === 'developer' ? '开发人员' : '负责人')
  : curDim.value?.label ?? ''))

const params = () => {
  const p = { dim: q.dim, timeField: q.timeField, granularity: q.granularity }
  if (q.dim === 'owner') p.personField = q.personField
  if (q.project.length) p.project = q.project.join(',')
  if (q.stage.length) p.stage = q.stage.join(',')
  if (q.status.length) p.status = q.status.join(',')
  if (q.dateFrom) p.dateFrom = q.dateFrom
  if (q.dateTo) p.dateTo = q.dateTo
  return p
}

// 列标签（与原型一致：周=MM-DD周，月=YYYY-MM月，日=MM-DD）
const colLabel = (c) => {
  if (c === '（空）') return c
  if (q.granularity === 'month') return c + '月'
  if (q.granularity === 'week') return c.slice(5) + '周'
  return c.slice(5)
}

// 图形统计：行维度分布（横向条形）与时间趋势（柱状图+折线图组合），按各自最大值归一
const CHART_COLORS = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399', '#9b59b6', '#1abc9c', '#d68910', '#16a085', '#c0392b']
const chartRows = computed(() => {
  if (!data.value) return []
  const values = data.value.rows.map((r) => data.value.rowTotals[r] || 0)
  const max = Math.max(1, ...values)
  const total = values.reduce((a, b) => a + b, 0) || 1
  return data.value.rows.map((r, i) => ({
    label: r,
    value: values[i],
    pct: Math.round((values[i] / max) * 100),
    share: Math.round((values[i] / total) * 1000) / 10,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }))
})
const chartCols = computed(() => {
  if (!data.value) return []
  const values = data.value.cols.map((c) => data.value.colTotals[c] || 0)
  const max = Math.max(1, ...values)
  return data.value.cols.map((c, i) => ({
    label: c === '（空）' ? '空' : c.slice(5),
    value: values[i],
    pct: Math.round((values[i] / max) * 100),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }))
})
// 折线图：时间趋势各点的 SVG 坐标（viewBox 300×100，柱子中心对齐），并计算相对上一点的增减百分比
const lineDots = computed(() => {
  const cols = chartCols.value
  if (!cols.length) return []
  const n = cols.length
  return cols.map((c, i) => {
    const prev = i > 0 ? cols[i - 1].value : null
    let change = null
    if (prev !== null) {
      change = prev === 0 ? (c.value === 0 ? 0 : 100) : Math.round(((c.value - prev) / prev) * 100)
    }
    return {
      x: Math.round(((i + 0.5) * 300 / n) * 10) / 10,
      y: 100 - c.pct,
      label: c.label,
      value: c.value,
      change,
      changeText: change === null ? '' : `${change > 0 ? '+' : ''}${change}%`,
    }
  })
})
const linePoints = computed(() => lineDots.value.map((d) => `${d.x},${d.y}`).join(' '))

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

// 用 canvas 绘制图表（浏览器原生中文字体），返回 base64 PNG 供 Excel 嵌入
function canvasPng(width, height, draw) {
  const c = document.createElement('canvas')
  const dpr = 2
  c.width = width * dpr
  c.height = height * dpr
  const ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'middle'
  draw(ctx, width, height)
  return c.toDataURL('image/png').split(',')[1]
}
function buildCharts() {
  const charts = []
  // 行维度分布（横向条形）
  const rows = chartRows.value
  if (rows.length) {
    const h = Math.max(240, 60 + rows.length * 26)
    charts.push(canvasPng(640, h, (ctx, w) => {
      ctx.fillStyle = '#303133'
      ctx.font = 'bold 16px sans-serif'
      ctx.fillText(`${dimLabel.value}分布`, 20, 24)
      ctx.font = '12px sans-serif'
      const left = 110
      const barW = w - left - 110
      rows.forEach((r, i) => {
        const y = 50 + i * 26
        ctx.fillStyle = '#606266'
        ctx.fillText(r.label.length > 10 ? r.label.slice(0, 10) + '…' : r.label, 20, y + 8)
        ctx.fillStyle = '#f0f2f5'
        ctx.fillRect(left, y, barW, 14)
        ctx.fillStyle = r.color
        ctx.fillRect(left, y, Math.round(barW * r.pct / 100), 14)
        ctx.fillStyle = '#409eff'
        ctx.fillText(`${r.value} (${r.share}%)`, left + barW + 8, y + 8)
      })
    }))
  }
  // 时间趋势（柱状 + 折线 + 增减百分比）
  const cols = chartCols.value
  const dots = lineDots.value
  if (cols.length) {
    charts.push(canvasPng(640, 320, (ctx, w, height) => {
      ctx.fillStyle = '#303133'
      ctx.font = 'bold 16px sans-serif'
      ctx.fillText('时间趋势（柱状+折线）', 20, 24)
      const left = 50; const right = w - 20; const top = 50; const bottom = height - 46
      const plotH = bottom - top
      ctx.strokeStyle = '#e4e7ed'
      ctx.lineWidth = 1
      for (let i = 0; i <= 4; i++) {
        const y = top + plotH * i / 4
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke()
      }
      const slot = (right - left) / cols.length
      const bw = Math.min(36, slot * 0.5)
      cols.forEach((c, i) => {
        const cx = left + slot * (i + 0.5)
        const bh = plotH * c.pct / 100
        ctx.fillStyle = c.color
        ctx.fillRect(cx - bw / 2, bottom - bh, bw, bh)
        ctx.fillStyle = '#909399'
        ctx.font = '11px sans-serif'
        ctx.fillText(c.label, cx - 18, bottom + 16)
      })
      ctx.strokeStyle = '#409eff'
      ctx.lineWidth = 2
      ctx.beginPath()
      dots.forEach((d, i) => {
        const x = left + slot * (i + 0.5)
        const y = bottom - plotH * (d.value / Math.max(1, ...cols.map(c => c.value)))
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()
      dots.forEach((d, i) => {
        const x = left + slot * (i + 0.5)
        const y = bottom - plotH * (d.value / Math.max(1, ...cols.map(c => c.value)))
        ctx.fillStyle = '#409eff'
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill()
        if (d.change !== null) {
          ctx.fillStyle = d.change > 0 ? '#67c23a' : d.change < 0 ? '#f56c6c' : '#909399'
          ctx.font = '11px sans-serif'
          ctx.fillText(d.changeText, x - 16, y - 14)
        }
      })
    }))
  }
  return charts
}

async function doExport() {
  const blob = await exportPivot(params(), buildCharts())
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `统计透视-${dimLabel.value}-${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}

// 穿透查询：数字/合计点击后带上报表过滤 + 行维度 + 时间桶跳转问题列表
const EMPTY_MARK = '__EMPTY__'
const pad2 = (n) => String(n).padStart(2, '0')
const DAY = 86400000
// 时间桶 → 日期范围（空桶返回 null）
function bucketRange(c) {
  if (c === '（空）') return null
  if (q.granularity === 'day') return { from: c, to: c }
  if (q.granularity === 'week') {
    const d = new Date(c + 'T00:00:00')
    const to = new Date(d.getTime() + 6 * DAY)
    return { from: c, to: `${to.getFullYear()}-${pad2(to.getMonth() + 1)}-${pad2(to.getDate())}` }
  }
  const [y, m] = c.split('-').map(Number)
  return { from: `${c}-01`, to: `${c}-${pad2(new Date(y, m, 0).getDate())}` }
}
function drillCell(row, col) {
  const query = {}
  const addVal = (k, v) => {
    const cur = query[k] ? query[k].split(',') : []
    if (!cur.includes(v)) cur.push(v)
    query[k] = cur.join(',')
  }
  if (q.project.length) query.project = q.project.join(',')
  if (q.stage.length) query.stage = q.stage.join(',')
  if (q.status.length) query.status = q.status.join(',')
  const rowKey = q.dim === 'owner' ? q.personField : q.dim
  if (row && row !== '（空）') addVal(rowKey, row)
  else if (row === '（空）') addVal(rowKey, EMPTY_MARK)
  const dateKey = q.timeField === 'resolvedAt' ? 'resolved_at' : 'plan_end'
  query.timeField = q.timeField
  if (col === '（空）') addVal(dateKey, EMPTY_MARK)
  else if (col) {
    const r = bucketRange(col)
    if (r) { query.dateFrom = r.from; query.dateTo = r.to }
  }
  router.push({ path: '/issues', query })
}

onMounted(async () => {
  try {
    const cfg = await http.get('/config/fields', { params: { scope: 1 } })
    projectOptions.value = (cfg.projects || []).map((p) => p.code)
    stageDicts.value = cfg.dicts.stage || []
    statusOptions.value = (cfg.dicts.status || []).map((d) => d.value)
  } catch { /* 过滤下拉失败不影响透视 */ }
  load()
})
</script>

<template>
  <div style="padding: 14px 20px 30px">
    <div class="toolbar">
      <BackHome />
      <el-select v-model="q.dim" style="width: 110px" @change="load">
        <el-option v-for="d in DIMS" :key="d.key" :value="d.key" :label="d.label" />
      </el-select>
      <el-select v-if="q.dim === 'owner'" v-model="q.personField" style="width: 105px" @change="load">
        <el-option value="owner" label="按负责人" />
        <el-option value="developer" label="按开发人员" />
      </el-select>
      <el-radio-group v-model="q.granularity" @change="load">
        <el-radio-button v-for="g in GRANS" :key="g.key" :value="g.key">{{ g.label }}</el-radio-button>
      </el-radio-group>
      <el-select v-model="q.project" multiple collapse-tags clearable placeholder="项目过滤" style="width: 140px" @change="onProjectChange">
        <el-option v-for="p in projectOptions" :key="p" :value="p" :label="p" />
      </el-select>
      <el-select v-model="q.stage" multiple collapse-tags clearable placeholder="阶段过滤" style="width: 125px" @change="load">
        <el-option v-for="s in stageOptions" :key="s" :value="s" :label="s" />
      </el-select>
      <el-select v-model="q.status" multiple collapse-tags clearable placeholder="状态过滤" style="width: 125px" @change="load">
        <el-option v-for="s in statusOptions" :key="s" :value="s" :label="s" />
      </el-select>
      <el-select v-model="q.timeField" style="width: 105px" @change="load">
        <el-option value="planEnd" label="预计完成" />
        <el-option value="resolvedAt" label="实际完成" />
      </el-select>
      <el-date-picker v-model="q.dateFrom" type="date" value-format="YYYY-MM-DD" clearable
        :placeholder="(q.timeField === 'planEnd' ? '预计完成' : '实际完成') + '起'" style="width: 130px" @change="load" />
      <el-date-picker v-model="q.dateTo" type="date" value-format="YYYY-MM-DD" clearable
        :placeholder="(q.timeField === 'planEnd' ? '预计完成' : '实际完成') + '止'" style="width: 130px" @change="load" />
      <el-tooltip content="锁定表头：滚动时表头固定；锁定行列：表头与行维度列、合计列同时固定" placement="bottom">
        <el-select v-model="lockMode" style="width: 110px" @change="setLockMode">
          <el-option label="不锁定" value="" />
          <el-option label="锁定表头" value="header" />
          <el-option label="锁定行列" value="both" />
        </el-select>
      </el-tooltip>
      <el-button :disabled="!auth.has('DATA_EXPORT')" @click="doExport">导出 Excel</el-button>
    </div>

    <el-card v-loading="loading" shadow="never">
      <template #header>
        <div class="hd">
          <span>{{ dimLabel }} × {{ q.timeField === 'planEnd' ? '预计完成' : '实际完成' }}（{{ GRANS.find(g => g.key === q.granularity).label }}）</span>
          <span class="tot">合计 <b>{{ data?.grandTotal ?? 0 }}</b> 条</span>
        </div>
      </template>
      <div v-if="data" class="report-body">
      <div class="pivot-wrap" :style="lockMode ? { maxHeight: TABLE_MAX_HEIGHT } : undefined">
      <table class="pivot" :class="{ 'lock-header': lockMode === 'header', 'lock-both': lockMode === 'both' }">
        <thead>
          <tr>
            <th class="row-hd">{{ dimLabel }}</th>
            <th v-for="c in data.cols" :key="c">{{ colLabel(c) }}</th>
            <th class="sum">合计</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in data.rows" :key="r">
            <td class="row-hd link" @click="drillCell(r, null)">{{ r }}</td>
            <td v-for="c in data.cols" :key="c" class="num" :class="{ zero: !data.matrix[r][c] }" @click="data.matrix[r][c] && drillCell(r, c)">{{ data.matrix[r][c] || '-' }}</td>
            <td class="sum num" @click="drillCell(r, null)">{{ data.rowTotals[r] }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="row-hd">合计</td>
            <td v-for="c in data.cols" :key="c" class="num" @click="drillCell(null, c)">{{ data.colTotals[c] || 0 }}</td>
            <td class="sum num" @click="drillCell(null, null)">{{ data.grandTotal }}</td>
          </tr>
        </tfoot>
      </table>
      </div>
      <aside class="chart-panel">
        <div class="chart-block">
          <div class="chart-title">{{ dimLabel }}分布</div>
          <div class="bar-row" v-for="r in chartRows" :key="r.label">
            <span class="bar-label" :title="r.label">{{ r.label }}</span>
            <div class="bar-track"><div class="bar-fill" :style="{ width: r.pct + '%', background: r.color }"></div></div>
            <span class="bar-value">{{ r.value }}</span>
            <span class="bar-share">{{ r.share }}%</span>
          </div>
        </div>
        <div class="chart-block">
          <div class="chart-title">时间趋势（柱状+折线）</div>
          <div class="trend-combo">
            <div class="col-chart">
              <div class="col-item" v-for="c in chartCols" :key="c.label + c.value">
                <div class="col-bar" :style="{ height: (c.pct * 0.9) + '%', background: c.color }" :title="c.value + ' 条'"></div>
              </div>
            </div>
            <svg class="trend-line" viewBox="0 0 300 100" preserveAspectRatio="none">
              <polyline :points="linePoints" class="line-path" />
              <circle v-for="d in lineDots" :key="d.x" :cx="d.x" :cy="d.y" r="3" class="line-dot">
                <title>{{ d.label }}：{{ d.value }} 条</title>
              </circle>
              </svg>
              <div class="change-labels">
              <span v-for="d in lineDots" :key="d.x" v-show="d.change !== null"
                class="change-tag" :class="{ up: d.change > 0, down: d.change < 0 }"
                :style="{ left: (d.x / 300 * 100) + '%', top: (d.y / 100 * 100) + '%' }">
                {{ d.changeText }}
              </span>
              </div>
              </div>
          <div class="line-labels">
            <span v-for="d in lineDots" :key="d.x">{{ d.label }}</span>
          </div>
        </div>
      </aside>
      </div>
      <el-empty v-else description="暂无数据" />
    </el-card>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: nowrap; overflow-x: auto; align-items: center; padding-bottom: 4px; }
.hd { display: flex; justify-content: space-between; align-items: center; }
.tot b { color: var(--el-color-primary); }
.pivot { width: 100%; border-collapse: collapse; font-size: 13px; }
.pivot th, .pivot td { border: 1px solid var(--el-border-color-lighter); padding: 6px 10px; text-align: center; }
.pivot th { background: var(--el-fill-color-light); font-weight: 600; }
.pivot .row-hd { text-align: left; font-weight: 500; }
.pivot .row-hd.link, .pivot .num { color: var(--el-color-primary); cursor: pointer; }
.pivot .num:hover, .pivot .row-hd.link:hover { text-decoration: underline; }
.pivot .zero { color: var(--el-text-color-disabled); cursor: default; }
.pivot .sum { background: var(--el-fill-color-lighter); font-weight: 600; }
/* 表格锁定：表头吸顶、行维度列与合计列吸边（原生 table 用 sticky 实现，与问题列表三档模式一致） */
.pivot-wrap { overflow: auto; }
.pivot.lock-header thead th,
.pivot.lock-both thead th { position: sticky; top: 0; z-index: 3; }
.pivot.lock-both tbody td.row-hd,
.pivot.lock-both tfoot td.row-hd { position: sticky; left: 0; z-index: 2; background: var(--el-bg-color); box-shadow: 1px 0 0 var(--el-border-color-lighter); }
.pivot.lock-both thead th.row-hd { left: 0; z-index: 5; box-shadow: 1px 0 0 var(--el-border-color-lighter); }
.pivot.lock-both tbody td.sum,
.pivot.lock-both tfoot td.sum { position: sticky; right: 0; z-index: 2; box-shadow: -1px 0 0 var(--el-border-color-lighter); }
.pivot.lock-both thead th.sum { right: 0; z-index: 5; box-shadow: -1px 0 0 var(--el-border-color-lighter); }
/* 右侧图形统计 */
.report-body { display: flex; gap: 12px; align-items: flex-start; }
.report-body > .pivot-wrap { flex: 1; min-width: 0; }
.chart-panel { width: 300px; flex: 0 0 300px; display: flex; flex-direction: column; gap: 12px; }
.chart-block { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 10px 12px; background: var(--el-fill-color-blank); }
.chart-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: var(--el-text-color-primary); }
.bar-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 12px; }
.bar-label { width: 70px; flex: 0 0 70px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-regular); }
.bar-track { flex: 1; height: 12px; background: var(--el-fill-color-light); border-radius: 6px; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, var(--el-color-primary-light-5), var(--el-color-primary)); border-radius: 6px; }
.bar-value { width: 32px; flex: 0 0 32px; text-align: right; font-weight: 600; color: var(--el-color-primary); }
.bar-share { width: 38px; flex: 0 0 38px; text-align: right; font-size: 11px; color: var(--el-text-color-secondary); }
.trend-combo { position: relative; height: 110px; }
.col-chart { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 6px; border-bottom: 1px solid var(--el-border-color-lighter); }
.col-item { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
.col-bar { width: 60%; max-width: 24px; min-height: 2px; background: linear-gradient(180deg, var(--el-color-primary-light-5), var(--el-color-primary-light-7)); border-radius: 3px 3px 0 0; }
.trend-line { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.line-path { fill: none; stroke: var(--el-color-primary); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.line-dot { fill: var(--el-color-primary); stroke: var(--el-bg-color); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.change-labels { position: absolute; inset: 0; pointer-events: none; }
.change-tag { position: absolute; transform: translate(-50%, -135%); padding: 1px 3px; border-radius: 3px; font-size: 9px; line-height: 1.2; white-space: nowrap; background: var(--el-bg-color); color: var(--el-text-color-secondary); }
.change-tag.up { color: var(--el-color-success); }
.change-tag.down { color: var(--el-color-danger); }
.line-labels { display: flex; justify-content: space-around; padding: 4px 6px 0; font-size: 10px; color: var(--el-text-color-secondary); }
</style>
