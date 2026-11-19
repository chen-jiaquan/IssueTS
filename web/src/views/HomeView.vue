<script setup>
// 首页工作台：KPI / 状态分布 / 预警事项 / 通知公告 / 我的待办
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/store/auth'
import http from '@/api/http'
import { listNoticeTypes } from '@/api/archives'
import ThemeSwitcher from '@/components/ThemeSwitcher.vue'
import MultiCheckboxSelect from '@/components/MultiCheckboxSelect.vue'
import {
  getSummary, getAlerts, listNotices, createNotice, updateNotice, deleteNotice,
  listTodos, createTodo, updateTodo, deleteTodo,
} from '@/api/home'

const router = useRouter()
const auth = useAuthStore()

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
const scopedPerson = computed(() => auth.scope !== null && !!auth.user?.person)
const personOptions = computed(() => cfgPersonnel.value.map((p) => p.name).filter(Boolean))
const groupOptions = computed(() => [...new Set(cfgPersonnel.value.map((p) => p.group).filter(Boolean))])

const filterParams = () => ({ project: filter.project.join(',') })
const drillQuery = (extra = {}) => {
  const q = { ...extra }
  if (filter.project.length) q.project = filter.project.join(',')
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
  await loadStats()
  try {
    const [n, t] = await Promise.all([listNotices(), listTodos()])
    notices.value = n
    todos.value = t
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
  if (!noticeForm.projects.length) return ElMessage.warning('项目必填')
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
const todoForm = reactive({ text: '', projects: [], owner: '', due: '', prio: 'M', done: false })

function openTodo(row = null) {
  editingTodo.value = row
  Object.assign(todoForm, row
    ? { text: row.text, projects: row.projects || [], owner: row.owner || '', due: row.due ? String(row.due).slice(0, 10) : '', prio: row.prio || 'M', done: row.done }
    : { text: '', projects: [...filter.project], owner: auth.user?.person || '', due: '', prio: 'M', done: false })
  todoDialog.value = true
}
async function saveTodo() {
  if (!todoForm.text.trim()) return ElMessage.warning('内容必填')
  const payload = { ...todoForm, due: todoForm.due || null }
  if (editingTodo.value) await updateTodo(editingTodo.value.id, payload)
  else await createTodo(payload)
  ElMessage.success('已保存')
  todoDialog.value = false
  loadAll()
}
async function toggleTodo(row) {
  await updateTodo(row.id, { text: row.text, projects: row.projects || [], owner: row.owner, due: row.due, prio: row.prio, done: row.done })
  loadAll()
}
async function removeTodo(row) {
  await ElMessageBox.confirm(`删除待办「${row.text}」？`, '删除', { type: 'warning' })
  await deleteTodo(row.id)
  loadAll()
}

// ---------- 跳转 ----------
const goIssues = (query = {}) => router.push({ path: '/issues', query })

async function doLogout() {
  await auth.logout()
  ElMessage.success('已登出')
  router.push('/login')
}

const fmtDate = (v) => (v ? String(v).slice(0, 10) : '')

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
        <el-button v-if="auth.has('ISSUE_VIEW')" size="small" @click="goIssues()">问题跟踪</el-button>
        <el-button v-if="auth.has('ISSUE_VIEW')" size="small" @click="router.push('/stats')">统计报表</el-button>
        <el-button v-if="auth.has('ARCHIVE_MGR')" size="small" @click="router.push('/archives')">基础档案设置</el-button>
        <el-button v-if="auth.has('SECURITY_MGR') || auth.has('ARCHIVE_MGR') || auth.has('DASH_ALERT')" size="small" @click="router.push('/security')">用户与权限</el-button>
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
      <div class="kpi" @click="goIssues(drillQuery())">
        <div class="num">{{ summary?.projectCount ?? '-' }}</div>
        <div class="lbl">{{ filter.project.length || scopedPerson ? '统计项目' : '可见项目' }}</div>
      </div>
      <div class="kpi" @click="goIssues(drillQuery())">
        <div class="num">{{ summary?.issueTotal ?? '-' }}</div>
        <div class="lbl">问题总数</div>
      </div>
      <div class="kpi danger" @click="goIssues(drillQuery({ overdue: 1 }))">
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
        <div v-for="(a, i) in alerts" :key="i" class="alert-item" @click="goIssues({ seq: a.issueSeq })">
          <el-tag size="small" :type="LEVEL[a.level].type">{{ LEVEL[a.level].text }}</el-tag>
          <span class="alert-text">{{ a.text }}</span>
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
        <div v-if="!notices.length" class="empty">暂无通知</div>
        <div v-for="n in notices" :key="n.id" class="notice-item">
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
      </el-card>

      <!-- 我的待办 -->
      <el-card shadow="never" class="block">
        <template #header>
          <div class="hd">
            <span>待办事项</span>
            <el-button v-if="auth.has('DASH_TODO')" size="small" type="primary" plain @click="openTodo()">新增</el-button>
          </div>
        </template>
        <div v-if="!todos.length" class="empty">暂无待办</div>
        <div v-for="t in todos" :key="t.id" class="todo-item" :class="{ done: t.done }">
          <el-checkbox :model-value="t.done" :disabled="!auth.has('DASH_TODO')" @change="t.done = $event; toggleTodo(t)" />
          <div class="todo-main">
            <div class="todo-text">{{ t.text }}</div>
            <div class="todo-meta">
              <el-tag size="small" :type="PRIO[t.prio] || 'info'" effect="plain">{{ PRIO_LABEL[t.prio] || t.prio }}</el-tag>
              <el-tag v-for="p in (t.projects || [])" :key="p" size="small" effect="plain">{{ p }}</el-tag>
              <span v-if="t.owner"> · {{ t.owner }}</span>
              <span v-if="t.due"> · 截止 {{ fmtDate(t.due) }}</span>
            </div>
          </div>
          <div v-if="auth.has('DASH_TODO')" class="todo-ops">
            <el-button link size="small" @click="openTodo(t)">编辑</el-button>
            <el-button link size="small" type="danger" @click="removeTodo(t)">删除</el-button>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 通知编辑 -->
    <el-dialog v-model="noticeDialog" :title="editingNotice ? '编辑通知' : '新增通知'" width="560px" top="5vh">
      <el-form :model="noticeForm" label-width="80px">
        <el-form-item label="标题" required><el-input v-model="noticeForm.title" maxlength="255" /></el-form-item>
        <el-form-item label="项目" required>
          <MultiCheckboxSelect v-model="noticeForm.projects" :options="projectSelectOptions" placeholder="请选择项目（可多选）" filterable />
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
        <el-form-item label="截止"><el-date-picker v-model="todoForm.due" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="todoForm.prio" style="width:100%">
            <el-option v-for="(lbl, k) in PRIO_LABEL" :key="k" :value="k" :label="`${k} ${lbl}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="已完成"><el-switch v-model="todoForm.done" /></el-form-item>
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
.kpi { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 14px 16px; cursor: pointer; transition: box-shadow .2s; }
.kpi:hover { box-shadow: var(--el-box-shadow-light); }
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
.alert-item { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px dashed var(--el-border-color-lighter); cursor: pointer; }
.alert-text { font-size: 13px; line-height: 1.5; }
.notice-item { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px dashed var(--el-border-color-lighter); }
.notice-title { font-size: 14px; font-weight: 500; }
.notice-meta { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.notice-content { font-size: 13px; margin-top: 4px; color: var(--el-text-color-regular); }
.notice-ops { white-space: nowrap; }
.todo-item { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px dashed var(--el-border-color-lighter); }
.todo-item.done .todo-text { text-decoration: line-through; color: var(--el-text-color-disabled); }
.todo-main { flex: 1; }
.todo-text { font-size: 13px; }
.todo-meta { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.todo-meta .el-tag { margin-right: 4px; }
.todo-ops { white-space: nowrap; }
</style>
