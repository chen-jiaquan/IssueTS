<script setup>
// 用户与权限：用户管理 + 角色/权限位/预警规则 + 角色权限矩阵 + 系统设置 + 系统状态监控
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import http from '@/api/http'
import { useAuthStore } from '@/store/auth'
import { SECURITY_TAB_PERM } from '@/permissionMenus'
import {
  listUsers, createUser, updateUser, deleteUser,
  listRoles, listPermissions, updatePermission, getRolePerms, putRolePerms,
  getIssueExportLimit, putIssueExportLimit, getDefaultUserPassword, putDefaultUserPassword,
  getPlanExportLimit, putPlanExportLimit, getReportExportLimit, putReportExportLimit,
  getTodoDueDays, putTodoDueDays, getTodoStatuses, putTodoStatuses,
} from '@/api/security'
import {
  createRole, updateRole, deleteRole, listAlertRules, putAlertRule,
} from '@/api/archives'
import {
  getMonitorStatus, kickOnlineSession, getPortConfig, updatePortConfig,
  getIdleTimeout, updateIdleTimeout,
} from '@/api/monitor'

const auth = useAuthStore()
const isSystemAdminRole = (code, name) => code === 'R01' || name === '管理员'
const currentIsSystemAdmin = computed(() => isSystemAdminRole(auth.user?.role_code, auth.user?.role))
// 二级菜单权限（一级总权限已移除，统一按页签级权限位判断）。
const canUsers = auth.has(SECURITY_TAB_PERM.users)
const canRoles = auth.has(SECURITY_TAB_PERM.roles)
// 权限位菜单仅系统管理员角色可见（不再仅凭权限位判断）。
const canPerms = currentIsSystemAdmin.value
const canMatrix = auth.has(SECURITY_TAB_PERM.matrix)
const canAlerts = auth.has(['DASH_ALERT', SECURITY_TAB_PERM.alerts])
const canSettings = auth.has(SECURITY_TAB_PERM.settings)
// 系统状态监控涉及数据库与服务器资源，仅系统管理员角色可见。
const canMonitor = currentIsSystemAdmin.value
const canSecurity = canUsers || canMatrix || canSettings || canMonitor
const canArchive = canRoles || canPerms
const canAlert = canAlerts
const tab = ref(canUsers ? 'users' : canRoles ? 'roles' : canPerms ? 'permissions'
  : canMatrix ? 'matrix' : canAlerts ? 'alerts' : canSettings ? 'settings'
    : canMonitor ? 'monitor' : 'users')

// ---------- 基础数据 ----------
const users = ref([])
const allUsers = ref([])
const roles = ref([])
const perms = ref([])
const alertRules = ref([])
const projects = ref([])
const personnelNames = ref([])
const matrix = reactive({}) // role_code -> Set(perm_code)
const savingRole = ref('')
const loading = ref(false)

const monitor = ref(null)
const monitorLoading = ref(false)
const monitorAutoRefresh = ref(true)
const monitorUpdatedAt = ref('')
const portConfig = ref({
  server: { appPort: 3000, listenAddress: '0.0.0.0', env: 'development' },
  database: { host: 'localhost', port: 5432, name: 'issue_tracker', user: 'issue', poolMax: 20, passwordConfigured: false },
  redis: { enabled: false, host: 'localhost', port: 6379, passwordConfigured: false },
  envFile: '.env',
  restartRequired: true,
})
const portSaving = ref(false)
const idleTimeout = ref({ minutes: 30 })
const idleSaving = ref(false)
let monitorTimer = null

const usersProjectFilter = ref([])
const rolesProjectFilter = ref([])
const matrixProjectFilter = ref([])
const settingsProjectFilter = ref([])

const visibleProjects = () => projects.value.filter((p) => p.enabled !== false && (!auth.scope || auth.scope.includes(p.code)))
const projectOptions = computed(() => visibleProjects().map((p) => ({ value: p.code, label: `${p.code} ${p.name}` })))
const projectSelectOptions = computed(() => [
  ...(auth.scope ? [] : [{ value: 'ALL', label: '全部项目（ALL）' }]),
  ...projectOptions.value,
])
const projectLabel = (code) => (code === 'ALL'
  ? '全部项目'
  : (projects.value.find((p) => p.code === code)?.name ?? code))
const projectLabels = (list) => {
  const codes = list || []
  if (!codes.length) return '—'
  if (codes.includes('ALL')) return '全部项目'
  return codes.map(projectLabel).join('、')
}
const filterByProject = (rows, selected) => {
  const codes = Array.isArray(selected) ? selected : (selected ? [selected] : [])
  if (!codes.length) return rows
  return rows.filter((r) => {
    const own = r.projects || []
    return own.includes('ALL') || codes.some((c) => own.includes(c))
  })
}
const filteredUsers = computed(() => filterByProject(users.value, usersProjectFilter.value))
const filteredRoles = computed(() => filterByProject(roles.value, rolesProjectFilter.value))
// 角色权限矩阵按所选项目过滤角色列（与后端按项目过滤保持一致的本地视图）。
const filteredMatrixRoles = computed(() => filterByProject(roles.value, matrixProjectFilter.value))
// 系统设置：不选项目表示全局默认（管理员可选 ALL 覆盖全部项目），非管理员只能维护具体项目。
const settingsTargetProjects = computed(() => [...settingsProjectFilter.value])
const settingsScopeLabel = computed(() => {
  const codes = settingsTargetProjects.value
  if (!codes.length) return currentIsSystemAdmin.value ? '全局默认设置' : '项目默认设置（请选择具体项目后保存）'
  if (codes.includes('ALL')) return '全部项目（ALL）'
  return codes.map(projectLabel).join('、')
})
// 非管理员未选择具体项目（或选择 ALL）时，系统设置字段只读不可编辑。
const settingsFieldsDisabled = computed(() =>
  !currentIsSystemAdmin.value
  && (!settingsTargetProjects.value.length || settingsTargetProjects.value.includes('ALL')))
// 自动下线是全局会话安全配置，仅管理员可维护。
const idleConfigDisabled = computed(() => !currentIsSystemAdmin.value)

const roleName = (code) => roles.value.find((r) => r.code === code)?.name ?? code
const roleColor = (code) => roles.value.find((r) => r.code === code)?.color

async function loadBase() {
  const [prj, pers] = await Promise.all([
    http.get('/archives/projects'),
    http.get('/archives/personnel'),
  ])
  projects.value = prj.filter((x) => x.enabled !== false)
  personnelNames.value = pers.filter((x) => x.enabled !== false).map((x) => x.name)
  // 角色列表与权限字典独立加载：任一接口失败不影响另一份数据（矩阵页需要两者）。
  if (canRoles || canMatrix) {
    try { roles.value = await listRoles() } catch { /* 单页签加载失败不阻断其他数据 */ }
  }
  if (canPerms || canMatrix || canRoles) {
    try { perms.value = await listPermissions() } catch { /* 权限字典加载失败单独处理 */ }
  }
  if (canAlerts) alertRules.value = await listAlertRules()
}

async function loadRoles() {
  if (!canRoles && !canMatrix) return
  roles.value = await listRoles()
}

async function loadAlerts() {
  if (!canAlerts) return
  alertRules.value = await listAlertRules()
}

// ---------- 角色档案 ----------
const roleDialog = ref(false)
const editingRole = ref(null)
const roleForm = reactive({ code: '', name: '', desc: '', external: false, color: '', preset: false, projects: [] })
const roleSaving = ref(false)
// 与用户管理一致：按当前登录账号角色判断所属项目必填。
const roleProjectRequired = computed(() => !currentIsSystemAdmin.value)
const roleProjectPlaceholder = computed(() =>
  roleProjectRequired.value ? '所属项目必填，请选择' : '当前管理员账号可不填')

// 系统预置角色（R01~R05）不允许编辑和删除。
const isProtectedRole = (row) => !!row?.preset

function openRole(row = null) {
  if (isProtectedRole(row)) return ElMessage.warning('系统预置角色不允许编辑')
  editingRole.value = row
  Object.assign(roleForm, row
    ? { code: row.code, name: row.name, desc: row.desc || '', external: !!row.external, color: row.color || '', preset: !!row.preset, projects: [...(row.projects || [])] }
    : { code: '', name: '', desc: '', external: false, color: '', preset: false, projects: [] })
  roleDialog.value = true
}

async function saveRoleArchive() {
  if (isProtectedRole(editingRole.value)) return ElMessage.warning('系统预置角色不允许编辑')
  if (!roleForm.code.trim()) return ElMessage.warning('编码必填')
  if (!roleForm.name.trim()) return ElMessage.warning('角色名必填')
  if (roleProjectRequired.value && !roleForm.projects.length) return ElMessage.warning('所属项目必填')
  roleSaving.value = true
  try {
    const payload = { ...roleForm }
    if (editingRole.value) await updateRole(editingRole.value.code, payload)
    else await createRole(payload)
    ElMessage.success('已保存')
    roleDialog.value = false
    await loadRoles()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    roleSaving.value = false
  }
}

async function removeRole(row) {
  if (isProtectedRole(row)) return ElMessage.warning('系统预置角色不允许删除')
  await ElMessageBox.confirm(`确认删除角色「${row.name}」？删除不可恢复。`, '删除', { type: 'warning' })
  try {
    await deleteRole(row.code)
    ElMessage.success('已删除')
    await loadRoles()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function togglePermNoAssign(row) {
  try {
    await updatePermission(row.code, { code: row.code, no_assign: !!row.no_assign })
    ElMessage.success(row.no_assign ? '已设为禁止分配，将清除已有授权' : '已允许分配')
  } catch (e) {
    row.no_assign = !row.no_assign
    ElMessage.error(e.message)
  }
}

// ---------- 预警规则 ----------
async function saveAlertRule(row) {
  const snapshot = { ...row }
  try {
    await putAlertRule({
      key: row.key,
      enabled: !!row.enabled,
      days: row.days === '' ? null : Number(row.days),
      preset: !!row.preset,
    })
    ElMessage.success(`规则「${row.label}」已保存`)
  } catch (e) {
    Object.assign(row, snapshot)
    ElMessage.error(e.message)
  }
}

async function loadUsers() {
  if (!canUsers) return
  users.value = await listUsers(usersProjectFilter.value)
}

async function loadAllUsers() {
  if (!canUsers) return
  allUsers.value = await listUsers()
}

async function loadMatrix() {
  if (!canMatrix) return
  const rows = await getRolePerms(matrixProjectFilter.value)
  for (const r of roles.value) matrix[r.code] = new Set()
  for (const row of rows) (matrix[row.role_code] ??= new Set()).add(row.perm_code)
}

// ---------- 用户表单 ----------
const userDialog = ref(false)
const editingUser = ref(null)
const userForm = reactive({ username: '', password: '', person: '', role_code: '', status: '启用', projects: [], preset: false })
const isPersonnelUser = computed(() => !!editingUser.value?.personnel_code)
const isProtectedUser = (row) => !!row && (row.username === 'admin' || !!row.preset)
// 管理员角色（R01）仅系统预置 admin 账号可用：新增或编辑其他用户时不提供该选项。
const canAssignAdminRole = computed(() => editingUser.value?.username === 'admin')
const selectableRoles = computed(() => canAssignAdminRole.value
  ? roles.value
  : roles.value.filter((r) => !isSystemAdminRole(r.code, r.name)))
// 用户管理按当前登录账号角色判断：系统管理员可不填，其余登录角色必填。
const userProjectRequired = computed(() => !currentIsSystemAdmin.value)
const userProjectPlaceholder = computed(() =>
  userProjectRequired.value ? '所属项目必填，请选择' : '当前管理员账号可不填')

function openUser(row = null) {
  editingUser.value = row
  Object.assign(userForm, row
    ? { username: row.username, password: '', person: row.person || '', role_code: row.role_code, status: row.status, projects: [...(row.projects || [])], preset: !!row.preset }
    : { username: '', password: '', person: '', role_code: selectableRoles.value[0]?.code ?? '', status: '启用', projects: [], preset: false })
  userDialog.value = true
}

async function saveUser() {
  if (!userForm.username.trim()) return ElMessage.warning('用户名必填')
  if (!userForm.role_code) return ElMessage.warning('角色必填')
  if (!canAssignAdminRole.value) {
    const chosen = roles.value.find((r) => r.code === userForm.role_code)
    if (chosen && isSystemAdminRole(chosen.code, chosen.name)) return ElMessage.warning('管理员角色仅系统预置 admin 账号可用')
  }
  if (!editingUser.value && (userForm.password || '').length < 6) return ElMessage.warning('密码至少 6 位')
  const name = String(userForm.person || '').trim()
  const duplicate = allUsers.value.find((u) =>
    Number(u.id) !== Number(editingUser.value?.id)
    && String(u.person ?? '').trim().toLowerCase() === name.toLowerCase())
  if (name && duplicate) return ElMessage.warning(`姓名「${name}」已存在，不允许重复`)
  if (userProjectRequired.value && !userForm.projects.length) return ElMessage.warning('所属项目必填')
  const payload = { ...userForm }
  try {
    if (!editingUser.value) {
      await createUser(payload)
      ElMessage.success('用户已创建')
    } else {
      if (!payload.password) delete payload.password
      await updateUser(editingUser.value.id, payload)
      ElMessage.success('用户已更新')
    }
  } catch (e) {
    return ElMessage.error(e.message)
  }
  userDialog.value = false
  await loadAllUsers()
  await loadUsers()
}

async function toggleStatus(row) {
  if (isProtectedUser(row)) return ElMessage.warning('系统预置账号不允许停用')
  await updateUser(row.id, { ...row, status: row.status === '启用' ? '停用' : '启用', password: undefined })
  ElMessage.success(`已${row.status === '启用' ? '停用' : '启用'} ${row.username}`)
  loadUsers()
}

async function resetPassword(row) {
  const { value } = await ElMessageBox.prompt(`为 ${row.username} 设置新密码（≥6 位）`, '重置密码', {
    inputType: 'password',
    inputValidator: (v) => (v && v.length >= 6) || '密码至少 6 位',
  })
  await updateUser(row.id, { ...row, password: value })
  ElMessage.success('密码已重置')
}

async function removeUser(row) {
  if (isProtectedUser(row)) return ElMessage.warning('系统预置账号不允许删除')
  await ElMessageBox.confirm(`确认删除用户 ${row.username}？`, '删除用户', { type: 'warning' })
  await deleteUser(row.id)
  ElMessage.success('已删除')
  loadUsers()
}

// ---------- 权限矩阵 ----------
const permGroups = computed(() => {
  const map = new Map()
  for (const p of perms.value) {
    const m = p.module || '其他'
    if (!map.has(m)) map.set(m, [])
    map.get(m).push(p)
  }
  return [...map.entries()]
})

// 管理员角色（R01）的权限列仅系统管理员角色可修改。
const canEditRolePerms = (roleCode) => !isSystemAdminRole(roleCode) || currentIsSystemAdmin.value

function togglePerm(roleCode, permCode, checked) {
  if (!canEditRolePerms(roleCode)) return
  if (!matrix[roleCode]) matrix[roleCode] = new Set()
  if (checked) matrix[roleCode].add(permCode)
  else matrix[roleCode].delete(permCode)
}

const assignablePerms = computed(() => perms.value.filter((p) => !p.no_assign))
const roleHasAll = (roleCode) => assignablePerms.value.length > 0
  && assignablePerms.value.every((p) => matrix[roleCode]?.has(p.code))
const setRoleAll = (roleCode) => {
  if (!canEditRolePerms(roleCode)) return
  matrix[roleCode] = new Set(roleHasAll(roleCode) ? [] : assignablePerms.value.map((p) => p.code))
}

async function saveRole(roleCode) {
  if (!canEditRolePerms(roleCode)) return ElMessage.warning('管理员角色的权限仅系统管理员角色可修改')
  savingRole.value = roleCode
  try {
    const assignable = new Set(assignablePerms.value.map((p) => p.code))
    const codes = [...(matrix[roleCode] || [])].filter((c) => assignable.has(c))
    await putRolePerms(roleCode, codes)
    ElMessage.success(`${roleName(roleCode)} 权限已保存（${codes.length} 项）`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingRole.value = ''
  }
}

const rowsOfRole = (roleCode) => assignablePerms.value.filter((p) => matrix[roleCode]?.has(p.code)).length

// ---------- 系统设置 ----------
const settingsSubTab = ref('plan')
const exportLimit = ref(0)
const planExportLimit = ref(0)
const reportExportLimit = ref(0)
const defaultPassword = ref('')
const settingsSaving = ref(false)
const passwordSaving = ref(false)
const todoDueDays = ref(7)
const todoStatuses = ref([])
const todoStatusOptions = ref([])
const todoDaysSaving = ref(false)
const todoStatusesSaving = ref(false)

async function loadSettings() {
  if (!canSettings) return
  const projects = settingsTargetProjects.value
  const [limit, planLimit, reportLimit, password, days, statuses, cfg] = await Promise.all([
    getIssueExportLimit(projects), getPlanExportLimit(projects), getReportExportLimit(projects),
    getDefaultUserPassword(projects), getTodoDueDays(projects), getTodoStatuses(projects),
    http.get('/config/fields'),
  ])
  exportLimit.value = limit
  planExportLimit.value = planLimit
  reportExportLimit.value = reportLimit
  defaultPassword.value = password
  todoDueDays.value = days
  todoStatuses.value = statuses
  todoStatusOptions.value = (cfg.dicts?.status || []).map((s) => s.value)
}

function checkSettingsTarget() {
  const codes = settingsTargetProjects.value
  if (!currentIsSystemAdmin.value && !codes.length) {
    ElMessage.warning('非管理员请先选择要维护的项目')
    return false
  }
  if (!currentIsSystemAdmin.value && codes.includes('ALL')) {
    ElMessage.warning('非管理员不能维护全部项目（ALL）设置')
    return false
  }
  return true
}

async function saveExportLimit(kind) {
  const sources = {
    issue: { value: exportLimit.value, save: putIssueExportLimit, label: '问题跟踪导出' },
    plan: { value: planExportLimit.value, save: putPlanExportLimit, label: '项目计划导出' },
    report: { value: reportExportLimit.value, save: putReportExportLimit, label: '报表导出' },
  }
  const source = sources[kind]
  const value = Number(source.value)
  if (!Number.isInteger(value) || value < 0 || value > 100000) {
    return ElMessage.warning('导出上限须为 0~100000 的整数')
  }
  if (!checkSettingsTarget()) return
  settingsSaving.value = true
  try {
    await source.save(value, settingsTargetProjects.value)
    ElMessage.success(`${settingsScopeLabel.value}：${source.label}${value === 0 ? '不限制行数' : `最多 ${value} 条`}`)
    await loadSettings()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    settingsSaving.value = false
  }
}

const saveIssueExportLimit = () => saveExportLimit('issue')
const savePlanExportLimit = () => saveExportLimit('plan')
const saveReportExportLimit = () => saveExportLimit('report')

async function saveDefaultPassword() {
  const value = String(defaultPassword.value || '').trim()
  if (value.length < 6 || value.length > 64) return ElMessage.warning('默认密码须为 6~64 位')
  if (!checkSettingsTarget()) return
  passwordSaving.value = true
  try {
    await putDefaultUserPassword(value, settingsTargetProjects.value)
    ElMessage.success(`${settingsScopeLabel.value}：默认用户密码已保存`)
    await loadSettings()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    passwordSaving.value = false
  }
}

async function saveTodoDueDays() {
  const value = Number(todoDueDays.value)
  if (!Number.isInteger(value) || value < 0 || value > 365) {
    return ElMessage.warning('完成时间窗口须为 0~365 的整数')
  }
  if (!checkSettingsTarget()) return
  todoDaysSaving.value = true
  try {
    await putTodoDueDays(value, settingsTargetProjects.value)
    ElMessage.success(`${settingsScopeLabel.value}：待办完成时间窗口已保存`)
    await loadSettings()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    todoDaysSaving.value = false
  }
}

async function saveTodoStatuses() {
  const value = todoStatuses.value
  if (!Array.isArray(value) || !value.length) return ElMessage.warning('请至少选择一种状态')
  if (!checkSettingsTarget()) return
  todoStatusesSaving.value = true
  try {
    await putTodoStatuses(value, settingsTargetProjects.value)
    ElMessage.success(`${settingsScopeLabel.value}：待办状态范围已保存`)
    await loadSettings()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    todoStatusesSaving.value = false
  }
}

// ---------- 系统状态监控 ----------
async function loadMonitor() {
  if (!canMonitor || monitorLoading.value) return
  monitorLoading.value = true
  try {
    monitor.value = await getMonitorStatus()
    monitorUpdatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  } catch (e) {
    ElMessage.error(e.message || '系统状态加载失败')
  } finally {
    monitorLoading.value = false
  }
}

const serverAccessCombo = computed(() =>
  `http://${portConfig.value.server.listenAddress}:${portConfig.value.server.appPort}`)
const dbConnectionCombo = computed(() => {
  const db = portConfig.value.database
  return `postgresql://${db.user}:***@${db.host}:${db.port}/${db.name}（连接池 ${db.poolMax}）`
})
const redisConnectionCombo = computed(() => {
  const redis = portConfig.value.redis
  return redis.enabled
    ? `redis://${redis.host}:${redis.port}（密码${redis.passwordConfigured ? '已配置' : '未配置'}）`
    : '未启用'
})

async function loadPortSettings() {
  if (!canMonitor) return
  try {
    portConfig.value = await getPortConfig()
  } catch (e) {
    ElMessage.error(e.message || '端口配置加载失败')
  }
}

async function savePortSettings() {
  const cfg = portConfig.value
  const ports = [cfg.server.appPort, cfg.database.port, cfg.redis.port]
  if (!ports.every((p) => Number.isInteger(Number(p)) && Number(p) >= 1 && Number(p) <= 65535)) {
    return ElMessage.warning('端口须为 1~65535 的整数')
  }
  portSaving.value = true
  try {
    portConfig.value = await updatePortConfig({
      appPort: Number(cfg.server.appPort),
      dbHost: cfg.database.host,
      dbPort: Number(cfg.database.port),
      dbName: cfg.database.name,
      dbUser: cfg.database.user,
      poolMax: Number(cfg.database.poolMax),
      redisEnabled: !!cfg.redis.enabled,
      redisHost: cfg.redis.host,
      redisPort: Number(cfg.redis.port),
    })
    ElMessage.success('连接配置已保存，重启后端服务后生效')
  } catch (e) {
    ElMessage.error(e.message || '连接配置保存失败')
  } finally {
    portSaving.value = false
  }
}

async function loadIdleSettings() {
  if (!canMonitor) return
  try {
    idleTimeout.value = await getIdleTimeout()
  } catch (e) {
    ElMessage.error(e.message || '自动下线配置加载失败')
  }
}

async function saveIdleSettings() {
  const minutes = Number(idleTimeout.value.minutes)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    return ElMessage.warning('自动下线时间须为 1~10080 分钟')
  }
  idleSaving.value = true
  try {
    idleTimeout.value = await updateIdleTimeout(minutes)
    ElMessage.success('自动下线时间已保存，立即生效')
    await loadMonitor()
  } catch (e) {
    ElMessage.error(e.message || '自动下线配置保存失败')
  } finally {
    idleSaving.value = false
  }
}

function toggleMonitorAuto(enabled) {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
  if (enabled && canMonitor) monitorTimer = setInterval(loadMonitor, 30000)
}

const formatUptime = (seconds) => {
  const total = Number(seconds || 0)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return days ? `${days}天 ${hours}小时 ${minutes}分` : `${hours}小时 ${minutes}分`
}

const formatDuration = (seconds) => {
  const total = Math.max(0, Number(seconds || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = Math.floor(total % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

const formatDateTime = (value) => value
  ? new Date(value).toLocaleString('zh-CN', { hour12: false })
  : '—'

async function kickSession(row) {
  await ElMessageBox.confirm(`确认将 ${row.username || '该用户'} 强制下线？`, '强制下线', { type: 'warning' })
  try {
    await kickOnlineSession(row.id)
    ElMessage.success(`${row.username || '用户'} 已强制下线`)
    await loadMonitor()
  } catch (e) {
    ElMessage.error(e.message || '强制下线失败')
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await loadBase()
    await Promise.all([
      loadUsers(), loadAllUsers(), loadMatrix(), loadSettings(),
      loadMonitor(), loadPortSettings(), loadIdleSettings(),
    ])
    toggleMonitorAuto(monitorAutoRefresh.value)
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  if (monitorTimer) clearInterval(monitorTimer)
})
</script>

<template>
  <div style="padding: 14px 20px 30px">
    <div style="margin-bottom:10px"><BackHome /></div>
    <el-tabs v-model="tab" v-loading="loading">
      <!-- ========== 用户管理 ========== -->
      <el-tab-pane v-if="canUsers" label="用户管理" name="users">
        <div class="toolbar">
          <el-button type="primary" @click="openUser()">新增用户</el-button>
          <el-select v-model="usersProjectFilter" multiple collapse-tags clearable placeholder="按所属项目过滤" style="width:240px" @change="loadUsers">
            <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
          <span class="tip">共 {{ filteredUsers.length }} 个账号（密码 bcrypt 存储，不回显）</span>
        </div>
        <el-table :data="filteredUsers" size="small" border stripe max-height="calc(100vh - 230px)">
          <el-table-column prop="username" label="编码" width="130" />
          <el-table-column prop="person" label="姓名" width="110" />
          <el-table-column label="系统预置" width="100">
            <template #default="{ row }">{{ row.preset ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column label="角色" width="140">
            <template #default="{ row }">
              <el-tag size="small" :color="roleColor(row.role_code) + '22'" :style="{ color: roleColor(row.role_code), borderColor: roleColor(row.role_code) }">
                {{ row.role_code }} {{ row.role_name }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="所属项目" min-width="200">
            <template #default="{ row }">{{ projectLabels(row.projects) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === '启用' ? 'success' : 'info'">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="230" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" type="primary" @click="openUser(row)">编辑</el-button>
              <el-button link size="small" @click="resetPassword(row)">重置密码</el-button>
              <el-button link size="small" :type="row.status === '启用' ? 'warning' : 'success'"
                :disabled="isProtectedUser(row)" :title="isProtectedUser(row) ? '系统预置账号不允许停用' : ''"
                @click="toggleStatus(row)">
                {{ row.status === '启用' ? '停用' : '启用' }}
              </el-button>
              <el-button link size="small" type="danger" :disabled="isProtectedUser(row)"
                :title="isProtectedUser(row) ? '系统预置账号不允许删除' : ''" @click="removeUser(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ========== 角色档案 ========== -->
      <el-tab-pane v-if="canRoles" label="角色" name="roles">
        <div class="toolbar">
          <el-button type="primary" @click="openRole()">新增角色</el-button>
          <el-select v-model="rolesProjectFilter" multiple collapse-tags clearable placeholder="按所属项目过滤" style="width:240px" @change="loadRoles">
            <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
          <span class="tip">角色授权在「角色权限」页签维护</span>
        </div>
        <el-table :data="filteredRoles" size="small" border stripe max-height="calc(100vh - 230px)">
          <el-table-column prop="code" label="编码" width="110" />
          <el-table-column prop="name" label="角色名" width="140" />
          <el-table-column label="所属项目" min-width="180">
            <template #default="{ row }">{{ projectLabels(row.projects) }}</template>
          </el-table-column>
          <el-table-column label="系统预置" width="100">
            <template #default="{ row }">{{ row.preset ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column prop="desc" label="描述" />
          <el-table-column label="外部角色" width="100">
            <template #default="{ row }">
              <el-tag size="small" :type="row.external ? 'warning' : 'info'">{{ row.external ? '是' : '否' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="颜色" width="100">
            <template #default="{ row }">
              <span v-if="row.color" :style="{ color: row.color }">● {{ row.color }}</span>
              <span v-else class="tip">—</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" type="primary" :disabled="isProtectedRole(row)"
                :title="isProtectedRole(row) ? '系统预置角色不允许编辑' : ''" @click="openRole(row)">编辑</el-button>
              <el-button link size="small" type="danger" :disabled="isProtectedRole(row)"
                :title="isProtectedRole(row) ? '系统预置角色不允许删除' : ''" @click="removeRole(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ========== 权限位（只读） ========== -->
      <el-tab-pane v-if="canPerms" label="权限位" name="permissions">
        <div class="toolbar"><span class="tip">可切换「禁止分配」开关；禁止分配的权限不可在「角色权限」页签授权，勾选时将清除其已有授权</span></div>
        <el-table :data="perms" size="small" border stripe max-height="calc(100vh - 230px)">
          <el-table-column prop="code" label="编码" width="150" />
          <el-table-column prop="module" label="模块" width="120" />
          <el-table-column prop="name" label="名称" width="200" />
          <el-table-column label="禁止分配" width="100">
            <template #default="{ row }">
              <el-switch v-model="row.no_assign" :disabled="!canPerms" @change="togglePermNoAssign(row)" />
            </template>
          </el-table-column>
          <el-table-column prop="desc" label="描述" />
        </el-table>
      </el-tab-pane>

      <!-- ========== 角色权限矩阵 ========== -->
      <el-tab-pane v-if="canMatrix" label="角色权限" name="matrix">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
          title="勾选即生效前需点列头「保存」；权限变更后用户下次登录/刷新档案生效" />
        <div class="toolbar">
          <el-select v-model="matrixProjectFilter" multiple collapse-tags clearable placeholder="按角色所属项目过滤" style="width:260px"
            @change="loadMatrix">
            <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
          <span class="tip">共 {{ filteredMatrixRoles.length }} 个角色</span>
        </div>
        <div class="matrix-wrap">
          <table class="matrix">
            <thead>
              <tr>
                <th class="first">权限位</th>
                <th v-for="r in filteredMatrixRoles" :key="r.code">
                  <div class="role-hd">
                    <div>{{ r.code }} {{ r.name }}</div>
                    <div class="role-sub">{{ rowsOfRole(r.code) }}/{{ assignablePerms.length }} 项</div>
                    <div class="role-ops">
                      <el-button link size="small" :disabled="!canEditRolePerms(r.code)"
                        :title="!canEditRolePerms(r.code) ? '管理员角色的权限仅系统管理员角色可修改' : ''"
                        @click="setRoleAll(r.code)">{{ roleHasAll(r.code) ? '清空' : '全选' }}</el-button>
                      <el-button link size="small" type="primary" :disabled="!canEditRolePerms(r.code)"
                        :loading="savingRole === r.code" @click="saveRole(r.code)">保存</el-button>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="[mod, list] in permGroups" :key="mod">
                <tr class="group-row">
                  <td :colspan="filteredMatrixRoles.length + 1">{{ mod }}</td>
                </tr>
                <tr v-for="p in list" :key="p.code" :class="{ 'no-assign-row': p.no_assign }">
                  <td class="first">
                    <span class="code">{{ p.code }}</span>
                    <span class="name">{{ p.name }}</span>
                    <span v-if="p.no_assign" class="no-assign-tag">禁止分配</span>
                    <div v-if="p.desc" class="desc">{{ p.desc }}</div>
                  </td>
                  <td v-for="r in filteredMatrixRoles" :key="r.code" class="cell">
                    <el-checkbox :model-value="matrix[r.code]?.has(p.code)"
                      :disabled="!!p.no_assign || !canEditRolePerms(r.code)"
                      :title="p.no_assign ? '该权限已设为禁止分配，不可在此授权'
                        : (!canEditRolePerms(r.code) ? '管理员角色的权限仅系统管理员角色可修改' : '')"
                      @change="(v) => togglePerm(r.code, p.code, v)" />
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </el-tab-pane>

      <!-- ========== 预警规则 ========== -->
      <el-tab-pane v-if="canAlerts" label="预警规则" name="alerts">
        <div class="toolbar">
          <span class="tip">启用后规则在首页工作台「预警事项」实时生效；custTest 的天数为已解决后未完成客户测试的容忍天数</span>
        </div>
        <el-table :data="alertRules" size="small" border max-height="calc(100vh - 230px)">
          <el-table-column prop="key" label="规则键" width="120" />
          <el-table-column prop="label" label="说明" min-width="240" />
          <el-table-column label="系统预置" width="100">
            <template #default="{ row }"><el-switch v-model="row.preset" @change="saveAlertRule(row)" /></template>
          </el-table-column>
          <el-table-column label="启用" width="80">
            <template #default="{ row }">
              <el-switch v-model="row.enabled" @change="saveAlertRule(row)" />
            </template>
          </el-table-column>
          <el-table-column label="阈值(天)" width="130">
            <template #default="{ row }">
              <el-input-number v-if="row.key === 'custTest'" v-model="row.days" :min="1" :max="90" size="small"
                @change="saveAlertRule(row)" />
              <span v-else class="tip">—</span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ========== 系统设置 ========== -->
      <el-tab-pane v-if="canSettings" label="系统设置" name="settings">
        <div class="toolbar">
          <el-select v-model="settingsProjectFilter" multiple collapse-tags clearable placeholder="按项目过滤设置" style="width:260px"
            @change="loadSettings">
            <el-option v-for="p in projectSelectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
          <span class="tip">
            当前范围：{{ settingsScopeLabel }}；
            {{ settingsFieldsDisabled ? '请先选择具体项目后再编辑' : '非管理员只能维护有权限的具体项目' }}
          </span>
        </div>
        <el-tabs v-model="settingsSubTab" type="card" class="settings-sub-tabs">
          <el-tab-pane label="项目计划" name="plan">
            <el-form label-width="140px" style="max-width: 560px">
              <el-form-item label="导出记录上限">
                <div style="display:flex; align-items:center; gap:12px; width:100%">
                  <el-input-number v-model="planExportLimit" :min="0" :max="100000" :step="100"
                    :disabled="settingsFieldsDisabled" controls-position="right" style="width: 220px" />
                  <span class="tip">0 = 不限制；最大 100000 条</span>
                </div>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :disabled="settingsFieldsDisabled" :loading="settingsSaving"
                  @click="savePlanExportLimit">保存项目计划导出设置</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="问题跟踪" name="issues">
            <el-form label-width="140px" style="max-width: 560px">
              <el-form-item label="导出记录上限">
                <div style="display:flex; align-items:center; gap:12px; width:100%">
                  <el-input-number v-model="exportLimit" :min="0" :max="100000" :step="100"
                    :disabled="settingsFieldsDisabled" controls-position="right" style="width: 220px" />
                  <span class="tip">0 = 不限制；最大 100000 条</span>
                </div>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :disabled="settingsFieldsDisabled" :loading="settingsSaving"
                  @click="saveIssueExportLimit">保存问题跟踪导出设置</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="报表" name="report">
            <el-form label-width="140px" style="max-width: 560px">
              <el-form-item label="导出记录上限">
                <div style="display:flex; align-items:center; gap:12px; width:100%">
                  <el-input-number v-model="reportExportLimit" :min="0" :max="100000" :step="100"
                    :disabled="settingsFieldsDisabled" controls-position="right" style="width: 220px" />
                  <span class="tip">0 = 不限制；最大 100000 条</span>
                </div>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :disabled="settingsFieldsDisabled" :loading="settingsSaving"
                  @click="saveReportExportLimit">保存报表导出设置</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="待办配置" name="todo">
            <el-form label-width="140px" style="max-width: 560px">
              <el-form-item label="待办完成时间">
                <div style="display:flex; align-items:center; gap:12px; width:100%">
                  <el-input-number v-model="todoDueDays" :min="0" :max="365" :step="1"
                    :disabled="settingsFieldsDisabled" controls-position="right" style="width: 220px" />
                  <span class="tip">完成日期不晚于今天 + N 天（含逾期），0 = 仅今天及逾期</span>
                </div>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :disabled="settingsFieldsDisabled" :loading="todoDaysSaving"
                  @click="saveTodoDueDays">保存待办完成时间</el-button>
              </el-form-item>
              <el-form-item label="待办状态范围">
                <div style="display:flex; align-items:center; gap:12px; width:100%">
                  <el-select v-model="todoStatuses" multiple collapse-tags clearable filterable
                    :disabled="settingsFieldsDisabled" placeholder="选择进入待办的状态" style="width: 220px">
                    <el-option v-for="s in todoStatusOptions" :key="s" :value="s" :label="s" />
                  </el-select>
                  <span class="tip">仅所选状态的问题与计划进入待办清单</span>
                </div>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :disabled="settingsFieldsDisabled" :loading="todoStatusesSaving"
                  @click="saveTodoStatuses">保存待办状态</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="通用" name="general">
            <el-form label-width="140px" style="max-width: 560px">
              <el-form-item label="默认用户密码">
                <div style="display:flex; align-items:center; gap:12px; width:100%">
                  <el-input v-model="defaultPassword" type="password" show-password style="width: 220px"
                    :disabled="settingsFieldsDisabled" placeholder="至少 6 位" />
                  <span class="tip">人员新增/修改后下推用户的初始密码</span>
                </div>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :disabled="settingsFieldsDisabled" :loading="passwordSaving"
                  @click="saveDefaultPassword">保存默认密码</el-button>
              </el-form-item>
              <el-form-item label="无操作自动下线（分钟）">
                <div style="display:flex; align-items:center; gap:12px; width:100%">
                  <el-input-number v-model="idleTimeout.minutes" :min="1" :max="10080"
                    :disabled="idleConfigDisabled" controls-position="right" style="width: 220px" />
                  <span class="tip">在线用户超过该时间无操作将自动下线</span>
                </div>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :disabled="idleConfigDisabled" :loading="idleSaving"
                  @click="saveIdleSettings">保存自动下线配置</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>
          <el-tab-pane v-if="canMonitor" label="用户监控" name="user-monitor">
            <div class="toolbar">
              <el-button :loading="monitorLoading" @click="loadMonitor">刷新</el-button>
              <span class="tip">最后更新：{{ monitorUpdatedAt || '—' }}</span>
            </div>
            <div class="status-counts">
              <div class="status-count">
                <div class="label">用户总数</div>
                <div class="value">{{ monitor?.users?.total ?? 0 }}</div>
              </div>
              <div class="status-count">
                <div class="label">启用</div>
                <div class="value success">{{ monitor?.users?.enabled ?? 0 }}</div>
              </div>
              <div class="status-count">
                <div class="label">停用</div>
                <div class="value warning">{{ monitor?.users?.disabled ?? 0 }}</div>
              </div>
              <div class="status-count">
                <div class="label">系统预置</div>
                <div class="value">{{ monitor?.users?.preset ?? 0 }}</div>
              </div>
              <div class="status-count">
                <div class="label">近 30 天新增</div>
                <div class="value primary">{{ monitor?.users?.recent_30d ?? 0 }}</div>
              </div>
              <div class="status-count">
                <div class="label">当前在线</div>
                <div class="value primary">{{ monitor?.users?.online?.total ?? 0 }}</div>
              </div>
            </div>

            <div class="monitor-section-title">按项目在线分布</div>
            <el-table :data="monitor?.users?.online?.by_project || []" size="small" border>
              <el-table-column prop="project_code" label="项目编码" width="140" />
              <el-table-column prop="project_name" label="项目名称" min-width="180" />
              <el-table-column prop="count" label="在线用户数" width="120" />
            </el-table>

            <div class="monitor-section-title">在线用户明细（可强制下线）</div>
            <el-table :data="monitor?.users?.online?.sessions || []" size="small" border max-height="320">
              <el-table-column prop="username" label="登录账号" width="130" />
              <el-table-column prop="person" label="姓名" width="110" />
              <el-table-column prop="role" label="角色" width="120" />
              <el-table-column prop="project_name" label="登录项目" min-width="160" />
              <el-table-column label="登录时间" width="170">
                <template #default="{ row }">{{ formatDateTime(row.login_at) }}</template>
              </el-table-column>
              <el-table-column label="在线时长" width="120">
                <template #default="{ row }">{{ formatDuration(row.online_seconds) }}</template>
              </el-table-column>
              <el-table-column label="最后活跃" width="170">
                <template #default="{ row }">{{ formatDateTime(row.last_seen_at) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="100" fixed="right">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="kickSession(row)">强制下线</el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-if="!monitor?.users?.online?.sessions?.length" description="当前没有在线用户" />
          </el-tab-pane>
        </el-tabs>
      </el-tab-pane>

      <!-- ========== 系统状态监控 ========== -->
      <el-tab-pane v-if="canMonitor" label="系统状态监控" name="monitor">
        <div class="toolbar">
          <el-button type="primary" :loading="monitorLoading" @click="loadMonitor">刷新</el-button>
          <el-switch v-model="monitorAutoRefresh" active-text="每 30 秒自动刷新" @change="toggleMonitorAuto" />
          <span class="tip">最后更新：{{ monitorUpdatedAt || '—' }}</span>
        </div>
        <el-card shadow="never" header="访问连接配置" style="margin-bottom: 16px">
          <el-alert type="warning" :closable="false" show-icon style="margin-bottom: 12px"
            title="配置按“服务监听 → PostgreSQL → Redis缓存”分组；保存后需重启后端服务生效，端口还需与实际服务监听端口一致。密码类配置不展示、不在本面板修改。" />
          <el-row :gutter="20">
            <el-col :xs="24" :lg="8">
              <div class="config-group-title">1. 服务监听</div>
              <el-form label-position="top" @submit.prevent>
                <el-form-item label="服务端口 APP_PORT">
                  <el-input-number v-model="portConfig.server.appPort" :min="1" :max="65535"
                    controls-position="right" style="width: 100%" />
                </el-form-item>
              </el-form>
              <el-descriptions :column="1" border size="small">
                <el-descriptions-item label="监听地址">{{ portConfig.server.listenAddress }}（固定）</el-descriptions-item>
                <el-descriptions-item label="运行环境">{{ portConfig.server.env }}</el-descriptions-item>
                <el-descriptions-item label="访问组合">{{ serverAccessCombo }}</el-descriptions-item>
              </el-descriptions>
            </el-col>
            <el-col :xs="24" :lg="10">
              <div class="config-group-title">2. PostgreSQL 数据库</div>
              <el-form label-position="top" @submit.prevent>
                <el-form-item label="主机 POSTGRES_HOST">
                  <el-input v-model="portConfig.database.host" placeholder="localhost" />
                </el-form-item>
                <el-row :gutter="8">
                  <el-col :span="12">
                    <el-form-item label="端口 POSTGRES_PORT">
                      <el-input-number v-model="portConfig.database.port" :min="1" :max="65535"
                        controls-position="right" style="width: 100%" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="连接池上限 PG_POOL_MAX">
                      <el-input-number v-model="portConfig.database.poolMax" :min="1" :max="200"
                        controls-position="right" style="width: 100%" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="8">
                  <el-col :span="12">
                    <el-form-item label="库名 POSTGRES_DB">
                      <el-input v-model="portConfig.database.name" placeholder="issue_tracker" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="用户 POSTGRES_USER">
                      <el-input v-model="portConfig.database.user" placeholder="issue" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </el-form>
              <div class="tip">连接组合：{{ dbConnectionCombo }}</div>
            </el-col>
            <el-col :xs="24" :lg="6">
              <div class="config-group-title">3. Redis 缓存（可选）</div>
              <el-form label-position="top" @submit.prevent>
                <el-form-item label="启用 REDIS_ENABLED">
                  <el-switch v-model="portConfig.redis.enabled" />
                </el-form-item>
                <el-form-item label="主机 REDIS_HOST">
                  <el-input v-model="portConfig.redis.host" placeholder="localhost" />
                </el-form-item>
                <el-form-item label="端口 REDIS_PORT">
                  <el-input-number v-model="portConfig.redis.port" :min="1" :max="65535"
                    controls-position="right" style="width: 100%" />
                </el-form-item>
              </el-form>
              <div class="tip">连接组合：{{ redisConnectionCombo }}</div>
            </el-col>
          </el-row>
          <div class="config-footer">
            <span class="tip">配置文件：{{ portConfig.envFile }}；密码类配置请在服务端环境文件中维护</span>
            <el-button type="primary" :loading="portSaving" @click="savePortSettings">保存连接配置</el-button>
          </div>
        </el-card>
        <el-row :gutter="16">
          <el-col :xs="24" :md="12">
            <el-card shadow="never" header="数据库监控">
              <el-descriptions v-if="monitor" :column="1" border size="small">
                <el-descriptions-item label="数据库">{{ monitor.database.name }}</el-descriptions-item>
                <el-descriptions-item label="版本">PostgreSQL {{ monitor.database.version }}</el-descriptions-item>
                <el-descriptions-item label="库大小">{{ monitor.database.size_pretty }}</el-descriptions-item>
                <el-descriptions-item label="数据库连接">
                  {{ monitor.database.connections }} / {{ monitor.database.max_connections }}
                </el-descriptions-item>
                <el-descriptions-item label="应用连接池">
                  总数 {{ monitor.database.pool.total }} · 空闲 {{ monitor.database.pool.idle }}
                  · 等待 {{ monitor.database.pool.waiting }} · 上限 {{ monitor.database.pool.max }}
                </el-descriptions-item>
              </el-descriptions>
              <el-empty v-else description="暂无数据" />
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-card shadow="never" header="服务器资源占用监控">
              <el-descriptions v-if="monitor" :column="1" border size="small">
                <el-descriptions-item label="主机">{{ monitor.server.hostname }}</el-descriptions-item>
                <el-descriptions-item label="平台">{{ monitor.server.platform }} · Node {{ monitor.server.node }}</el-descriptions-item>
                <el-descriptions-item label="进程运行时间">{{ formatUptime(monitor.server.uptime_seconds) }}</el-descriptions-item>
                <el-descriptions-item label="CPU">
                  {{ monitor.server.cpu_count }} 核 · 1 分钟负载 {{ monitor.server.cpu_load_1m }}
                </el-descriptions-item>
                <el-descriptions-item label="系统内存">
                  已用 {{ monitor.server.memory_used_percent }}% · 共 {{ monitor.server.memory_total_mb }} MB
                </el-descriptions-item>
                <el-descriptions-item label="进程内存">
                  RSS {{ monitor.server.process_rss_mb }} MB · Heap {{ monitor.server.process_heap_used_mb }} MB
                </el-descriptions-item>
              </el-descriptions>
              <el-empty v-else description="暂无数据" />
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>
    </el-tabs>
    <el-empty v-if="!canSecurity && !canArchive && !canAlert && !canMonitor" description="当前账号暂无用户与权限相关操作权限" />

    <!-- 用户编辑 -->
    <el-dialog v-model="userDialog" :title="editingUser ? `编辑用户 ${editingUser.username}` : '新增用户'" width="520px">
      <el-alert v-if="isPersonnelUser" type="info" :closable="false" show-icon style="margin-bottom:12px"
        :title="`该账号由人员档案 ${editingUser.personnel_code} 下推，用户名/姓名/所属项目请在人员档案中修改后同步`" />
      <el-form :model="userForm" label-width="90px">
        <el-form-item label="用户名" required>
          <el-input v-model="userForm.username" :disabled="!!editingUser" placeholder="登录账号" />
        </el-form-item>
        <el-form-item :label="editingUser ? '新密码' : '密码'" :required="!editingUser">
          <el-input v-model="userForm.password" type="password" show-password
            :placeholder="editingUser ? '留空则不修改' : '至少 6 位'" />
        </el-form-item>
        <el-form-item label="姓名">
          <div style="width:100%">
            <el-select v-model="userForm.person" filterable allow-create clearable :disabled="isPersonnelUser"
              style="width:100%" placeholder="姓名不允许重复">
              <el-option v-for="n in personnelNames" :key="n" :value="n" :label="n" />
            </el-select>
            <div class="tip" style="margin-top:4px">姓名不允许重复；人员下推账号请在人员档案中修改</div>
          </div>
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="userForm.role_code" style="width:100%">
            <el-option v-for="r in selectableRoles" :key="r.code" :value="r.code" :label="`${r.code} ${r.name}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="所属项目" :required="userProjectRequired">
          <div style="width:100%">
            <el-select v-model="userForm.projects" multiple filterable collapse-tags clearable :disabled="isPersonnelUser"
              style="width:100%" :placeholder="userProjectPlaceholder">
              <el-option v-for="p in projectSelectOptions" :key="p.value" :value="p.value" :label="p.label" />
            </el-select>
            <div class="tip" style="margin-top:4px">
              {{ userProjectRequired ? '当前登录角色非系统管理员，所属项目必填' : '当前登录角色为系统管理员，可不填' }}
              <span v-if="isPersonnelUser">；人员下推账号请到人员档案修改</span>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="userForm.status">
            <el-radio value="启用">启用</el-radio>
            <el-radio value="停用">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="系统预置">
          <el-switch v-model="userForm.preset" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userDialog = false">取消</el-button>
        <el-button type="primary" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>

    <!-- 角色编辑 -->
    <el-dialog v-model="roleDialog" :title="editingRole ? `编辑角色 ${editingRole.code}` : '新增角色'" width="480px">
      <el-form label-width="90px">
        <el-form-item label="编码" required>
          <el-input v-model="roleForm.code" :disabled="!!editingRole" placeholder="如 R06" />
        </el-form-item>
        <el-form-item label="角色名" required>
          <el-input v-model="roleForm.name" />
        </el-form-item>
        <el-form-item label="所属项目" :required="roleProjectRequired">
          <div style="width:100%">
            <el-select v-model="roleForm.projects" multiple filterable collapse-tags clearable style="width:100%"
              :placeholder="roleProjectPlaceholder">
              <el-option v-for="p in projectSelectOptions" :key="p.value" :value="p.value" :label="p.label" />
            </el-select>
            <div class="tip" style="margin-top:4px">
              {{ roleProjectRequired ? '当前登录角色非系统管理员，所属项目必填' : '当前登录角色为系统管理员，可不填' }}
            </div>
          </div>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="roleForm.desc" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="外部角色">
          <el-switch v-model="roleForm.external" />
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker v-model="roleForm.color" />
        </el-form-item>
        <el-form-item label="系统预置">
          <el-switch v-model="roleForm.preset" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialog = false">取消</el-button>
        <el-button type="primary" :loading="roleSaving" @click="saveRoleArchive">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.tip { font-size: 12px; color: var(--el-text-color-secondary); }
.status-counts { display: flex; flex-wrap: wrap; gap: 12px; }
.status-count { flex: 1 1 130px; padding: 12px 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color-blank); }
.status-count .label { font-size: 12px; color: var(--el-text-color-secondary); }
.status-count .value { margin-top: 6px; font-size: 22px; font-weight: 600; }
.status-count .value.success { color: var(--el-color-success); }
.status-count .value.warning { color: var(--el-color-warning); }
.status-count .value.primary { color: var(--el-color-primary); }
.monitor-section-title { margin: 14px 0 8px; font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); }
.config-group-title { margin-bottom: 12px; padding-left: 8px; border-left: 3px solid var(--el-color-primary); font-size: 13px; font-weight: 600; }
.config-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--el-border-color-lighter); }
.settings-sub-tabs { margin-top: 4px; }
.matrix-wrap { overflow-x: auto; }
.matrix { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 880px; }
.matrix th, .matrix td { border: 1px solid var(--el-border-color-lighter); padding: 6px 8px; }
.matrix th { background: var(--el-fill-color-light); }
.matrix .first { text-align: left; width: 220px; }
.matrix th.first { width: 220px; }
.role-hd { font-weight: 600; }
.role-sub { font-size: 11px; color: var(--el-text-color-secondary); font-weight: 400; }
.role-ops { margin-top: 2px; }
.matrix .cell { text-align: center; }
.group-row td { background: var(--el-fill-color-lighter); font-weight: 600; text-align: left; }
.code { font-family: monospace; color: var(--el-color-primary); margin-right: 6px; }
.name { font-weight: 500; }
.desc { font-size: 11px; color: var(--el-text-color-secondary); }
.no-assign-row { opacity: 0.6; }
.no-assign-tag { margin-left: 6px; font-size: 11px; color: var(--el-color-danger); border: 1px solid var(--el-color-danger); border-radius: 3px; padding: 0 4px; }
</style>
