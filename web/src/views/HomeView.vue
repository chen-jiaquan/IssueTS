<script setup>
// 首页工作台：KPI / 状态分布 / 预警事项 / 通知公告 / 我的待办
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/store/auth'
import { ARCHIVE_ENTRY_PERMS, SECURITY_ENTRY_PERMS } from '@/permissionMenus'
import http from '@/api/http'
import { listNoticeTypes } from '@/api/archives'
import ThemeSwitcher from '@/components/ThemeSwitcher.vue'
import MultiCheckboxSelect from '@/components/MultiCheckboxSelect.vue'
import CollapsibleList from '@/components/CollapsibleList.vue'
import {
  getSummary, getAlerts, listNotices, createNotice, updateNotice, deleteNotice,
  listTodos, listAggregatedTodos, createTodo, updateTodo, deleteTodo,
} from '@/api/home'

const router = useRouter()
const auth = useAuthStore()
const canArchives = computed(() => auth.has(ARCHIVE_ENTRY_PERMS))
const canSecurityEntry = computed(() => auth.has(SECURITY_ENTRY_PERMS))

const summary = ref(null)
const alerts = ref([])
const notices = ref([])
const todos = ref([])

// 统计过滤：项目
const filter = reactive({ project: [] })
const cfgProjects = ref([])
const cfgPersonnel = ref([])
const noticeTypes = ref([])
const statsLoading = ref(false)
const projectOptions = computed(() => cfgProjects.value.filter(
  (p) => !auth.scope || auth.scope.includes(p.code)))
const projectSelectOptions = computed(() => projectOptions.value.map((p) => ({ value: p.code, label: p.name || p.code })))
const scopedPerson = computed(() => auth.scope !== null && !auth.has('PROJECT_ALL') && !!auth.user?.person)
const personOptions = computed(() => cfgPersonnel.value.map((p) => p.name).filter(Boolean))
const groupOptions = computed(() => [...new Set(cfgPersonnel.value.map((p) => p.group).filter(Boolean))])

const filterParams = () => ({ project: filter.project.join(',') })
const drillQuery = (extra = {}) => {
  const q = { ...extra }
  if (filter.project.length) q.project = filter.project.join(',')
  if (scopedPerson.value) q.person = auth.user.person
  return q
}
function resetFilter() {
  filter.project = []
  loadStats()
}
async function loadMeta() {
  try {
    const cfg = await http.get('/config/fields', { params: { scope: 1 } })
    cfgProjects.value = cfg.projects || []
    cfgPersonnel.value = cfg.personnel || []
    const dictTypes = (cfg.dicts?.todo_type || []).filter((t) => t.enabled !== false).map((t) => t.value)
    todoTypes.value = dictTypes.length ? dictTypes : [...TODO_TYPE_FALLBACK]
  } catch { /* 过滤选项加载失败不影响看板 */ }
  try {
    noticeTypes.value = (await listNoticeTypes()).filter((t) => t.enabled !== false)
  } catch { /* 通知类型加载失败不影响看板 */ }
}

const resolvedRate = computed(() => {
  if (!summary.value?.issueTotal) return 0
  const s = summary.value.byStatus
  return Math.round((((s['已解决'] || 0) + (s['关闭'] || 0)) / summary.value.issueTotal) * 100)
})

const LEVEL = { high: { type: 'danger', text: '高' }, mid: { type: 'warning', text: '中' }, low: { type: 'info', text: '低' } }
const PRIO = { C: 'danger', H: 'warning', M: 'primary', L: 'info' }
const PRIO_LABEL = { C: '关键', H: '高', M: '中', L: '低' }
const ALERT_CATEGORIES = [
  { key: 'overdue', label: '逾期未关闭' },
  { key: 'highPause', label: '高优先级暂停' },
  { key: 'custTest', label: '客户测试超时' },
]
const alertGroups = computed(() => {
  const grouped = new Map(ALERT_CATEGORIES.map((c) => [c.key, []]))
  for (const a of alerts.value) {
    const key = grouped.has(a.type) ? a.type : 'other'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(a)
  }
  return [...grouped.entries()]
    .filter(([, items]) => items.length)
    .map(([key, items]) => ({ key, items, label: ALERT_CATEGORIES.find((c) => c.key === key)?.label || '其他预警' }))
})
const aggTodos = ref([])
const aggTab = ref('问题')
const aggGroups = computed(() => {
  const g = { 问题: [], 计划: [], 手工: [] }
  for (const r of aggTodos.value) {
    // 手工页签改用完整待办数据，跳过原本会落入手工页签的受限待办记录
    if (r.source === 'todo' && r.type !== '问题' && r.type !== '计划') continue
    const bucket = g[r.type] ?? g.手工
    bucket.push(r)
  }
  // 首页手工页签不设截止日期/状态限制，展示全部手工待办；列表页仍使用聚合口径
  g.手工 = todos.value
    .filter((t) => t.type !== '问题' && t.type !== '计划')
    .map((t) => ({
      source: 'todo',
      type: t.type,
      ref: t.id,
      ref_no: t.id,
      title: t.text,
      owner: t.owner,
      start_date: t.start_date,
      due_date: t.due || t.start_date,
      status: t.done ? '关闭' : '未开始',
      projects: t.projects || [],
      prio: t.prio,
    }))
  return g
})
const activeAggCount = (type) => aggGroups.value[type]
  .filter((a) => !(a.source === 'todo' && a.status === '关闭')).length

let statsSeq = 0
async function loadStats() {
  const seq = ++statsSeq
  statsLoading.value = true
  try {
    const params = filterParams()
    const [s, a] = await Promise.all([getSummary(params), getAlerts(params)])
    if (seq !== statsSeq) return
    summary.value = s
    alerts.value = a
  } catch (e) {
    if (seq === statsSeq) ElMessage.error(e.message)
  } finally {
    if (seq === statsSeq) statsLoading.value = false
  }
}
async function loadAll() {
  if (!auth.has('DASH_VIEW')) return
  await loadStats()
  try {
    const [n, t, a] = await Promise.all([listNotices(), listTodos(), listAggregatedTodos()])
    notices.value = n
    todos.value = t
    aggTodos.value = a
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// ---------- 通知 ----------
const noticeDialog = ref(false)
const editingNotice = ref(null)
const noticeForm = reactive({ title: '', projects: [], recipients: [], groups: [], content: '', date: '', pinned: false, type: '' })

function openNotice(row = null) {
  editingNotice.value = row
  Object.assign(noticeForm, row
    ? {
      title: row.title, projects: row.projects || [], recipients: row.recipients || [], groups: row.groups || [],
      content: row.content || '', date: row.date ? String(row.date).slice(0, 10) : '', pinned: row.pinned, type: row.type || '',
    }
    : {
      title: '', projects: [...filter.project], recipients: [], groups: [],
      content: '', date: new Date().toISOString().slice(0, 10), pinned: false, type: '',
    })
  noticeDialog.value = true
}
const noticeAudience = (n) => {
  const parts = []
  if (n.recipients?.length) parts.push(`接收人：${n.recipients.join('、')}`)
  if (n.groups?.length) parts.push(`组：${n.groups.join('、')}`)
  return parts.join('；')
}
async function saveNotice() {
  if (!noticeForm.title.trim()) return ElMessage.warning('标题必填')
  const payload = { ...noticeForm, date: noticeForm.date || null, type: noticeForm.type || null }
  if (editingNotice.value) await updateNotice(editingNotice.value.id, payload)
  else await createNotice(payload)
  ElMessage.success('已保存')
  noticeDialog.value = false
  loadAll()
}
async function removeNotice(row) {
  await ElMessageBox.confirm(`确认删除通知「${row.title}」？`, '删除', { type: 'warning' })
  await deleteNotice(row.id)
  loadAll()
}

// ---------- 待办 ----------
const todoDialog = ref(false)
const editingTodo = ref(null)
const todoForm = reactive({ text: '', projects: [], owner: '', start_date: '', due: '', completed_at: '', prio: 'M', type: '手工', done: false })
const TODO_TYPE_FALLBACK = ['问题', '计划', '手工']
const todoTypes = ref([])

function openTodo(row = null) {
  editingTodo.value = row
  Object.assign(todoForm, row
    ? {
      text: row.text, projects: row.projects || [], owner: row.owner || '',
      start_date: fmtDate(row.start_date),
      due: fmtDate(row.due), completed_at: fmtDate(row.completed_at), prio: row.prio || 'M',
      type: row.type || '手工', done: row.done,
    }
    : {
      text: '', projects: [...filter.project], owner: auth.user?.person || '',
      start_date: '', due: '', completed_at: '', prio: 'M', type: '手工', done: false,
    })
  todoDialog.value = true
}
async function saveTodo() {
  if (!todoForm.text.trim()) return ElMessage.warning('内容必填')
  const payload = { ...todoForm, start_date: todoForm.start_date || null, due: todoForm.due || null }
  if (editingTodo.value) await updateTodo(editingTodo.value.id, payload)
  else await createTodo(payload)
  ElMessage.success('已保存')
  todoDialog.value = false
  loadAll()
}
async function toggleTodo(row) {
  await updateTodo(row.id, {
    text: row.text, projects: row.projects || [], owner: row.owner,
    start_date: fmtDate(row.start_date) || null, due: fmtDate(row.due) || null, prio: row.prio,
    type: row.type || '手工', done: row.done,
  })
  loadAll()
}
async function removeTodo(row) {
  await ElMessageBox.confirm(`删除待办「${row.text}」？`, '删除', { type: 'warning' })
  await deleteTodo(row.id)
  loadAll()
}
const findTodo = (ref) => todos.value.find((t) => t.id === ref)
function toggleAggregateTodo(row, done) {
  const t = findTodo(row.ref)
  if (t) { t.done = !!done; toggleTodo(t) }
}
function editAggregateTodo(row) {
  const t = findTodo(row.ref)
  if (t) openTodo(t)
}
function removeAggregateTodo(row) {
  const t = findTodo(row.ref)
  if (t) removeTodo(t)
}

// ---------- 跳转 ----------
const goIssues = (query = {}) => router.push({ path: '/issues', query })
// 与待办清单页一致：带编号跳转，目标页加载后定位并高亮对应行
function locateAggregate(row) {
  if (row.source === 'issue') {
    router.push({ path: '/issues', query: { seq: row.ref_no, project: row.projects?.[0] || '', locate: '1' } })
  } else if (row.source === 'plan') {
    router.push({ path: '/plan', query: { project: row.projects?.[0] || '', wbs: row.ref_no, id: row.ref } })
  }
}

async function doLogout() {
  await auth.logout()
  ElMessage.success('已登出')
  router.push('/login')
}

function fmtDate(v) {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

onMounted(async () => {
  await loadMeta()
  loadAll()
})
</script>

<template>
  <div class="home">
    <div class="topbar">
      <span class="brand">问题跟踪系统</span>
      <div class="nav">
        <el-button v-if="auth.has('ISSUE_VIEW')" size="small" @click="router.push('/plan')">项目计划</el-button>
        <el-button v-if="auth.has('ISSUE_VIEW')" size="small" @click="router.push('/load-matrix')">负载矩阵</el-button>
        <el-button v-if="auth.has('ISSUE_VIEW')" size="small" @click="goIssues()">问题跟踪</el-button>
        <el-button v-if="auth.has('ISSUE_VIEW')" size="small" @click="router.push('/stats')">统计报表</el-button>
        <el-button v-if="canArchives" size="small" @click="router.push('/archives')">基础档案设置</el-button>
        <el-button v-if="canSecurityEntry" size="small" @click="router.push('/security')">用户与权限</el-button>
        <ThemeSwitcher />
        <el-dropdown>
          <el-button size="small">
            {{ auth.user?.person || auth.user?.username }}（{{ auth.user?.role }}）
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="doLogout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 统计过滤：项目 -->
    <el-card shadow="never" class="block filter-bar">
      <div class="filters">
        <span class="filter-lbl">统计口径</span>
        <MultiCheckboxSelect v-model="filter.project" :options="projectSelectOptions" width="220px"
          placeholder="全部项目" filterable @change="loadStats" />
        <el-button link type="primary" @click="resetFilter">重置</el-button>
        <span class="filter-hint">按本人负责/开发/提交的问题统计，随项目筛选自动刷新</span>
      </div>
    </el-card>

    <!-- KPI -->
    <div class="kpis" v-loading="statsLoading">
      <div class="kpi">
        <div class="num">{{ summary?.projectCount ?? '-' }}</div>
        <div class="lbl">{{ filter.project.length || scopedPerson ? '统计项目' : '可见项目' }}</div>
      </div>
      <div class="kpi clickable" @click="goIssues(drillQuery())">
        <div class="num">{{ summary?.issueTotal ?? '-' }}</div>
        <div class="lbl">问题总数</div>
      </div>
      <div class="kpi danger clickable" @click="goIssues(drillQuery({ overdue: 1 }))">
        <div class="num">{{ summary?.overdueCount ?? '-' }}</div>
        <div class="lbl">逾期未关闭</div>
      </div>
      <div class="kpi">
        <div class="num">{{ resolvedRate }}%</div>
        <div class="lbl">已解决占比</div>
      </div>
    </div>

    <!-- 状态/优先级分布 -->
    <el-card shadow="never" class="block" v-loading="statsLoading">
      <div class="dist">
        <div class="dist-row">
          <span class="tag-lbl">状态</span>
          <el-tag v-for="(v, k) in (summary?.byStatus || {})" :key="k" size="small" class="chip"
            :type="k === '已解决' ? 'success' : k === '暂停' ? 'warning' : k === '关闭' ? 'info' : ''"
            @click="goIssues(drillQuery({ status: k }))">{{ k }} {{ v }}</el-tag>
        </div>
        <div class="dist-row">
          <span class="tag-lbl">优先级</span>
          <el-tag v-for="(v, k) in (summary?.byPriority || {})" :key="k" size="small" class="chip"
            :type="PRIO[k]" @click="goIssues(drillQuery({ priority: k }))">{{ k }} {{ PRIO_LABEL[k] }} {{ v }}</el-tag>
        </div>
      </div>
    </el-card>

    <div class="grid">
      <!-- 预警事项 -->
      <el-card shadow="never" class="block" v-loading="statsLoading">
        <template #header>
          <div class="hd"><span>预警事项</span><el-tag size="small" type="danger" effect="plain">{{ alerts.length }}</el-tag></div>
        </template>
        <div v-if="!alerts.length" class="empty">暂无预警</div>
        <div v-for="g in alertGroups" :key="g.key" class="alert-group">
          <div class="alert-group-hd">
            <span>{{ g.label }}</span>
            <el-tag size="small" effect="plain">{{ g.items.length }}</el-tag>
          </div>
          <CollapsibleList :items="g.items" :limit="6" empty-text="暂无该分类预警">
            <template #item="{ item }">
              <div class="alert-item" @click="goIssues(drillQuery({ seq: item.issueSeq }))">
                <el-tag size="small" :type="LEVEL[item.level]?.type || 'info'">{{ LEVEL[item.level]?.text || item.level }}</el-tag>
                <span class="alert-text">{{ item.text }}</span>
              </div>
            </template>
          </CollapsibleList>
        </div>
      </el-card>

      <!-- 通知公告 -->
      <el-card shadow="never" class="block">
        <template #header>
          <div class="hd">
            <span>通知公告</span>
            <el-button v-if="auth.has('DASH_NOTICE')" size="small" type="primary" plain @click="openNotice()">新增</el-button>
          </div>
        </template>
        <CollapsibleList :items="notices" :limit="6" empty-text="暂无通知">
          <template #item="{ item: n }">
            <div :key="n.id" class="notice-item">
              <div class="notice-main">
                <div class="notice-title">
                  <el-tag v-if="n.pinned" size="small" type="danger" effect="dark" style="margin-right:6px">置顶</el-tag>
                  <el-tag v-for="p in (n.projects || [])" :key="p" size="small" effect="plain" style="margin-right:6px">{{ p }}</el-tag>
                  <el-tag v-if="n.type" size="small" effect="plain" style="margin-right:6px">{{ n.type }}</el-tag>
                  {{ n.title }}
                </div>
                <div class="notice-meta">
                  {{ fmtDate(n.date) }} · {{ n.created_by || '系统' }}<template v-if="noticeAudience(n)"> · {{ noticeAudience(n) }}</template>
                </div>
                <div v-if="n.content" class="notice-content">{{ n.content }}</div>
              </div>
              <div v-if="auth.has('DASH_NOTICE')" class="notice-ops">
                <el-button link size="small" @click="openNotice(n)">编辑</el-button>
                <el-button link size="small" type="danger" @click="removeNotice(n)">删除</el-button>
              </div>
            </div>
          </template>
        </CollapsibleList>
      </el-card>

      <!-- 待办事项：问题 / 计划 / 手工分类聚合 -->
      <el-card shadow="never" class="block">
        <template #header>
          <div class="hd">
            <span>待办事项</span>
            <div>
              <el-button size="small" plain @click="router.push('/todo-list')">列表</el-button>
              <el-button v-if="auth.has('DASH_TODO')" size="small" type="primary" plain @click="openTodo()">新增</el-button>
            </div>
          </div>
        </template>
        <el-tabs v-model="aggTab" class="todo-tabs">
          <el-tab-pane v-for="t in ['问题', '计划', '手工']" :key="t" :name="t">
            <template #label>{{ t }}（{{ activeAggCount(t) }}）</template>
            <CollapsibleList :items="aggGroups[t]" :limit="6" empty-text="暂无待办">
              <template #item="{ item: a }">
                <div class="todo-item">
                  <el-checkbox v-if="a.source === 'todo'" :model-value="a.status !== '关闭'" :disabled="!auth.has('DASH_TODO')" @change="toggleAggregateTodo(a, $event)" />
                  <span v-else class="todo-source-dot" />
                  <div class="todo-main">
                    <div class="todo-text" :class="{ done: a.source === 'todo' && a.status === '关闭' }">{{ a.title }}</div>
                    <div class="todo-meta">
                      <el-tag v-if="a.ref_no" size="small" type="info" effect="plain">编号 {{ a.ref_no }}</el-tag>
                      <el-tag v-if="a.prio" size="small" :type="PRIO[a.prio] || 'info'" effect="plain">{{ PRIO_LABEL[a.prio] || a.prio }}</el-tag>
                      <el-tag v-if="a.source !== 'todo'" size="small" effect="plain">{{ a.status }}</el-tag>
                      <el-tag v-for="p in (a.projects || [])" :key="p" size="small" effect="plain">{{ p }}</el-tag>
                      <span v-if="a.owner"> · {{ a.owner }}</span>
                      <span v-if="a.due_date"> · 截止 {{ fmtDate(a.due_date) }}</span>
                      <span v-if="a.source === 'todo' && findTodo(a.ref)?.completed_at"> · 完成 {{ fmtDate(findTodo(a.ref).completed_at) }}</span>
                    </div>
                  </div>
                  <div class="todo-ops">
                    <template v-if="a.source === 'todo' && auth.has('DASH_TODO')">
                      <el-button link size="small" @click="editAggregateTodo(a)">编辑</el-button>
                      <el-button link size="small" type="danger" @click="removeAggregateTodo(a)">删除</el-button>
                    </template>
                    <el-button v-else-if="a.source !== 'todo' && auth.has('ISSUE_VIEW')" link size="small" @click="locateAggregate(a)">查看</el-button>
                  </div>
                </div>
              </template>
            </CollapsibleList>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>

    <!-- 通知编辑 -->
    <el-dialog v-model="noticeDialog" :title="editingNotice ? '编辑通知' : '新增通知'" width="560px" top="5vh">
      <el-form :model="noticeForm" label-width="80px">
        <el-form-item label="标题" required><el-input v-model="noticeForm.title" maxlength="255" /></el-form-item>
        <el-form-item label="项目">
          <MultiCheckboxSelect v-model="noticeForm.projects" :options="projectSelectOptions" placeholder="可多选，留空则全员可见" filterable />
        </el-form-item>
        <el-form-item label="接收人">
          <MultiCheckboxSelect v-model="noticeForm.recipients" :options="personOptions" placeholder="选择人员（可空，默认通知项目全员）" filterable />
        </el-form-item>
        <el-form-item label="所属组">
          <MultiCheckboxSelect v-model="noticeForm.groups" :options="groupOptions" placeholder="选择人员所属组（可多选）" />
          <div class="form-hint">选择所属组后，该组人员均可收到通知</div>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="noticeForm.type" clearable placeholder="请选择通知类型" style="width:100%">
            <el-option v-for="t in noticeTypes" :key="t.id" :value="t.name" :label="t.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="noticeForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="内容"><el-input v-model="noticeForm.content" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="置顶"><el-switch v-model="noticeForm.pinned" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="noticeDialog = false">取消</el-button>
        <el-button type="primary" @click="saveNotice">保存</el-button>
      </template>
    </el-dialog>

    <!-- 待办编辑 -->
    <el-dialog v-model="todoDialog" :title="editingTodo ? '编辑待办' : '新增待办'" width="480px">
      <el-form :model="todoForm" label-width="70px">
        <el-form-item label="内容" required><el-input v-model="todoForm.text" maxlength="512" /></el-form-item>
        <el-form-item label="项目">
          <MultiCheckboxSelect v-model="todoForm.projects" :options="projectSelectOptions" placeholder="选择项目（可空，默认全员可见）" filterable />
        </el-form-item>
        <el-form-item label="负责人"><el-input v-model="todoForm.owner" /></el-form-item>
        <el-form-item label="开始日期"><el-date-picker v-model="todoForm.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="待办类型">
          <el-select v-model="todoForm.type" style="width:100%">
            <el-option v-for="t in todoTypes" :key="t" :value="t" :label="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="截止"><el-date-picker v-model="todoForm.due" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="todoForm.prio" style="width:100%">
            <el-option v-for="(lbl, k) in PRIO_LABEL" :key="k" :value="k" :label="`${k} ${lbl}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="已完成"><el-switch v-model="todoForm.done" /></el-form-item>
        <el-form-item label="实际完成">
          <el-date-picker v-model="todoForm.completed_at" type="date" value-format="YYYY-MM-DD"
            style="width:100%" disabled placeholder="勾选完成后自动填写当天日期" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="todoDialog = false">取消</el-button>
        <el-button type="primary" @click="saveTodo">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.home { padding: 0 20px 30px; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; }
.brand { font-size: 18px; font-weight: 600; }
.nav { display: flex; gap: 8px; align-items: center; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px; }
.kpi { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 14px 16px; transition: box-shadow .2s; }
.kpi.clickable { cursor: pointer; }
.kpi.clickable:hover { box-shadow: var(--el-box-shadow-light); }
.kpi .num { font-size: 26px; font-weight: 700; color: var(--el-color-primary); }
.kpi.danger .num { color: var(--el-color-danger); }
.kpi .lbl { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; }
.block { margin-bottom: 12px; }
.filter-bar .filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-lbl { font-size: 13px; color: var(--el-text-color-regular); }
.filter-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.form-hint { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.4; }
.dist-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 0; }
.tag-lbl { font-size: 12px; color: var(--el-text-color-secondary); width: 44px; }
.chip { cursor: pointer; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; }
.hd { display: flex; justify-content: space-between; align-items: center; }
.empty { color: var(--el-text-color-disabled); font-size: 13px; padding: 12px 0; }
.alert-group + .alert-group { margin-top: 10px; }
.alert-group-hd { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); margin-bottom: 4px; }
.alert-item { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px dashed var(--el-border-color-lighter); cursor: pointer; }
.alert-text { font-size: 13px; line-height: 1.5; }
.notice-item { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px dashed var(--el-border-color-lighter); }
.notice-title { font-size: 14px; font-weight: 500; }
.notice-meta { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.notice-content { font-size: 13px; margin-top: 4px; color: var(--el-text-color-regular); }
.notice-ops { white-space: nowrap; }
.todo-item { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px dashed var(--el-border-color-lighter); }
.todo-item.done .todo-text, .todo-text.done { text-decoration: line-through; color: var(--el-text-color-disabled); }
.todo-main { flex: 1; }
.todo-text { font-size: 13px; }
.todo-meta { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.todo-meta .el-tag { margin-right: 4px; }
.todo-ops { white-space: nowrap; }
.todo-source-dot { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--el-color-primary); flex: none; }
.todo-tabs :deep(.el-tabs__header) { margin-bottom: 6px; }
</style>
