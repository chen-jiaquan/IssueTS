<script setup>
// 用户与权限：用户管理 + 角色/权限位/预警规则 + 角色权限矩阵 + 系统设置
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import http from '@/api/http'
import { useAuthStore } from '@/store/auth'
import {
  listUsers, createUser, updateUser, deleteUser,
  listRoles, listPermissions, updatePermission, getRolePerms, putRolePerms,
  getIssueExportLimit, putIssueExportLimit, getDefaultUserPassword, putDefaultUserPassword,
} from '@/api/security'
import {
  createRole, updateRole, deleteRole, listAlertRules, putAlertRule,
} from '@/api/archives'

const auth = useAuthStore()
const canSecurity = auth.has('SECURITY_MGR')
const canArchive = auth.has('ARCHIVE_MGR')
const canAlert = auth.has('DASH_ALERT')
const tab = ref(canSecurity ? 'users' : canArchive ? 'roles' : 'alerts')

const isSystemAdminRole = (code, name) => code === 'R01' || name === '管理员'
const currentIsSystemAdmin = computed(() => isSystemAdminRole(auth.user?.role_code, auth.user?.role))
const requiresProject = (targetRole = null) =>
  targetRole ? !isSystemAdminRole(targetRole.code, targetRole.name) : !currentIsSystemAdmin.value

// ---------- 基础数据 ----------
const users = ref([])
const roles = ref([])
const perms = ref([])
const alertRules = ref([])
const projects = ref([])
const personnelNames = ref([])
const matrix = reactive({}) // role_code -> Set(perm_code)
const savingRole = ref('')
const loading = ref(false)

const usersProjectFilter = ref('')
const rolesProjectFilter = ref('')
const matrixProjectFilter = ref('')
const alertsProjectFilter = ref('')
const settingsProjectFilter = ref('')

const visibleProjects = () => projects.value.filter((p) => p.enabled !== false && (!auth.scope || auth.scope.includes(p.code)))
const projectOptions = computed(() => visibleProjects().map((p) => ({ value: p.code, label: `${p.code} ${p.name}` })))
const projectSelectOptions = computed(() => [
  ...(auth.scope ? [] : [{ value: 'ALL', label: '全部项目（ALL）' }]),
  ...projectOptions.value,
])
const projectLabels = (list) => {
  const codes = list || []
  if (codes.includes('ALL')) return '全部项目'
  return codes.map((c) => projects.value.find((p) => p.code === c)?.name || c).join('、')
}
const filterByProject = (rows, code) => !code
  ? rows
  : rows.filter((r) => (r.projects || []).includes(code) || (r.projects || []).includes('ALL'))
const filteredUsers = computed(() => filterByProject(users.value, usersProjectFilter.value))
const filteredRoles = computed(() => filterByProject(roles.value, rolesProjectFilter.value))
const matrixRoles = computed(() => filterByProject(roles.value, matrixProjectFilter.value))
const filteredAlertRules = computed(() => filterByProject(alertRules.value, alertsProjectFilter.value))

const roleName = (code) => roles.value.find((r) => r.code === code)?.name ?? code
const roleColor = (code) => roles.value.find((r) => r.code === code)?.color

async function loadBase() {
  const [prj, pers] = await Promise.all([
    http.get('/archives/projects'),
    http.get('/archives/personnel'),
  ])
  projects.value = prj.filter((x) => x.enabled !== false)
  personnelNames.value = pers.filter((x) => x.enabled !== false).map((x) => x.name)
  if (canArchive || canSecurity) {
    const [r, p] = await Promise.all([listRoles(), listPermissions()])
    roles.value = r
    perms.value = p
  }
  if (canAlert) alertRules.value = await listAlertRules(alertsProjectFilter.value)
}

async function loadRoles() {
  if (!canArchive && !canSecurity) return
  roles.value = await listRoles()
}

async function loadAlerts() {
  if (!canAlert) return
  alertRules.value = await listAlertRules(alertsProjectFilter.value)
}

// ---------- 角色档案 ----------
const roleDialog = ref(false)
const editingRole = ref(null)
const roleForm = reactive({ code: '', name: '', desc: '', external: false, color: '', preset: false, projects: [] })
const roleSaving = ref(false)

function openRole(row = null) {
  editingRole.value = row
  Object.assign(roleForm, row
    ? { code: row.code, name: row.name, desc: row.desc || '', external: !!row.external, color: row.color || '', preset: !!row.preset, projects: [...(row.projects || [])] }
    : { code: '', name: '', desc: '', external: false, color: '', preset: false, projects: [] })
  roleDialog.value = true
}

async function saveRoleArchive() {
  if (!roleForm.code.trim()) return ElMessage.warning('编码必填')
  if (!roleForm.name.trim()) return ElMessage.warning('角色名必填')
  if (requiresProject(roleForm) && !roleForm.projects.length) return ElMessage.warning('所属项目必填')
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
  await ElMessageBox.confirm(`确认删除角色「${row.name}」？删除不可恢复。`, '删除', { type: 'warning' })
  try {
    await deleteRole(row.code)
    ElMessage.success('已删除')
    await loadRoles()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function togglePermPreset(row) {
  try {
    await updatePermission(row.code, { code: row.code, preset: !!row.preset })
    ElMessage.success('已保存')
  } catch (e) {
    row.preset = !row.preset
    ElMessage.error(e.message)
  }
}

// ---------- 预警规则 ----------
async function saveAlertRule(row) {
  if (requiresProject() && !(row.projects || []).length) {
    await loadAlerts()
    return ElMessage.warning('所属项目必填')
  }
  const snapshot = { ...row, projects: [...(row.projects || [])] }
  try {
    await putAlertRule({
      key: row.key,
      enabled: !!row.enabled,
      days: row.days === '' ? null : Number(row.days),
      preset: !!row.preset,
      projects: row.projects,
    })
    ElMessage.success(`规则「${row.label}」已保存`)
  } catch (e) {
    Object.assign(row, snapshot)
    ElMessage.error(e.message)
  }
}

async function loadUsers() {
  if (!canSecurity) return
  users.value = await listUsers(usersProjectFilter.value)
}

async function loadMatrix() {
  if (!canSecurity) return
  const rows = await getRolePerms(matrixProjectFilter.value)
  for (const r of roles.value) matrix[r.code] = new Set()
  for (const row of rows) (matrix[row.role_code] ??= new Set()).add(row.perm_code)
}

// ---------- 用户表单 ----------
const userDialog = ref(false)
const editingUser = ref(null)
const userForm = reactive({ username: '', password: '', person: '', role_code: '', status: '启用', projects: [], preset: false })
const allProjects = ref(false)
const selectedUserRole = computed(() => roles.value.find((r) => r.code === userForm.role_code))

function openUser(row = null) {
  editingUser.value = row
  // 受限管理员不能授予/保留 ALL，强制按具体项目展示
  allProjects.value = !auth.scope && !!row?.projects?.includes('ALL')
  Object.assign(userForm, row
    ? { username: row.username, password: '', person: row.person || '', role_code: row.role_code, status: row.status, projects: allProjects.value ? [] : (row.projects || []).filter((p) => p !== 'ALL'), preset: !!row.preset }
    : { username: '', password: '', person: '', role_code: roles.value[0]?.code ?? '', status: '启用', projects: [], preset: false })
  userDialog.value = true
}

async function saveUser() {
  if (!userForm.username.trim()) return ElMessage.warning('用户名必填')
  if (!userForm.role_code) return ElMessage.warning('角色必填')
  if (!editingUser.value && (userForm.password || '').length < 6) return ElMessage.warning('密码至少 6 位')
  const finalProjects = allProjects.value ? ['ALL'] : userForm.projects
  if (requiresProject(selectedUserRole.value) && !finalProjects.length) return ElMessage.warning('所属项目必填')
  const payload = { ...userForm, projects: finalProjects }
  if (!editingUser.value) {
    await createUser(payload)
    ElMessage.success('用户已创建')
  } else {
    if (!payload.password) delete payload.password
    await updateUser(editingUser.value.id, payload)
    ElMessage.success('用户已更新')
  }
  userDialog.value = false
  loadUsers()
}

async function toggleStatus(row) {
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

function togglePerm(roleCode, permCode, checked) {
  if (!matrix[roleCode]) matrix[roleCode] = new Set()
  if (checked) matrix[roleCode].add(permCode)
  else matrix[roleCode].delete(permCode)
}

const roleHasAll = (roleCode) => perms.value.length > 0 && matrix[roleCode]?.size === perms.value.length
const setRoleAll = (roleCode) => {
  matrix[roleCode] = new Set(roleHasAll(roleCode) ? [] : perms.value.map((p) => p.code))
}

async function saveRole(roleCode) {
  savingRole.value = roleCode
  try {
    await putRolePerms(roleCode, [...(matrix[roleCode] || [])])
    ElMessage.success(`${roleName(roleCode)} 权限已保存（${matrix[roleCode]?.size || 0} 项）`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingRole.value = ''
  }
}

const rowsOfRole = (roleCode) => matrix[roleCode]?.size ?? 0

// ---------- 系统设置 ----------
const exportLimit = ref(0)
const defaultPassword = ref('')
const settingsProjects = ref([])
const settingsSaving = ref(false)
const passwordSaving = ref(false)

async function loadSettings() {
  if (!canSecurity) return
  const [limit, password] = await Promise.all([
    getIssueExportLimit(settingsProjectFilter.value),
    getDefaultUserPassword(settingsProjectFilter.value),
  ])
  exportLimit.value = limit
  defaultPassword.value = password
}

async function onSettingsProjectChange() {
  if (settingsProjectFilter.value) settingsProjects.value = [settingsProjectFilter.value]
  await loadSettings()
}

function ensureSettingsProject() {
  if (requiresProject() && !settingsProjects.value.length) {
    ElMessage.warning('所属项目必填')
    return false
  }
  return true
}

async function saveIssueExportLimit() {
  const value = Number(exportLimit.value)
  if (!Number.isInteger(value) || value < 0 || value > 100000) {
    return ElMessage.warning('导出上限须为 0~100000 的整数')
  }
  if (!ensureSettingsProject()) return
  settingsSaving.value = true
  try {
    await putIssueExportLimit(value, settingsProjects.value)
    exportLimit.value = value
    ElMessage.success(value === 0 ? '已保存：导出不限制行数' : `已保存：最多导出 ${value} 条`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    settingsSaving.value = false
  }
}

async function saveDefaultPassword() {
  const value = String(defaultPassword.value || '').trim()
  if (value.length < 6 || value.length > 64) return ElMessage.warning('默认密码须为 6~64 位')
  if (!ensureSettingsProject()) return
  passwordSaving.value = true
  try {
    await putDefaultUserPassword(value, settingsProjects.value)
    ElMessage.success('默认用户密码已保存；后续人员下推用户时使用')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    passwordSaving.value = false
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await loadBase()
    await Promise.all([loadUsers(), loadMatrix(), loadSettings()])
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div style="padding: 14px 20px 30px">
    <div style="margin-bottom:10px"><BackHome /></div>
    <el-tabs v-model="tab" v-loading="loading">
      <!-- ========== 用户管理 ========== -->
      <el-tab-pane v-if="canSecurity" label="用户管理" name="users">
        <div class="toolbar">
          <el-button type="primary" @click="openUser()">新增用户</el-button>
          <el-select v-model="usersProjectFilter" clearable placeholder="按所属项目过滤" style="width:180px" @change="loadUsers">
            <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
          <span class="tip">共 {{ filteredUsers.length }} 个账号（密码 bcrypt 存储，不回显）</span>
        </div>
        <el-table :data="filteredUsers" size="small" border stripe max-height="calc(100vh - 230px)">
          <el-table-column prop="username" label="用户名" width="130" />
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
            <template #default="{ row }">
              <el-tag v-if="row.projects?.includes('ALL')" size="small" type="warning" effect="plain">全部项目</el-tag>
              <el-tag v-for="p in (row.projects || []).filter(x => x !== 'ALL')" :key="p" size="small" style="margin-right:4px">{{ p }}</el-tag>
            </template>
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
              <el-button link size="small" :type="row.status === '启用' ? 'warning' : 'success'" @click="toggleStatus(row)">
                {{ row.status === '启用' ? '停用' : '启用' }}
              </el-button>
              <el-button link size="small" type="danger" @click="removeUser(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ========== 角色档案 ========== -->
      <el-tab-pane v-if="canArchive" label="角色" name="roles">
        <div class="toolbar">
          <el-button type="primary" @click="openRole()">新增角色</el-button>
          <el-select v-model="rolesProjectFilter" clearable placeholder="按所属项目过滤" style="width:180px" @change="loadRoles">
            <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
          <span class="tip">角色授权在「角色权限」页签维护</span>
        </div>
        <el-table :data="filteredRoles" size="small" border stripe max-height="calc(100vh - 230px)">
          <el-table-column prop="code" label="编码" width="110" />
          <el-table-column prop="name" label="角色名" width="140" />
          <el-table-column label="所属项目" min-width="180">
            <template #default="{ row }">{{ projectLabels(row.projects) || '—' }}</template>
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
              <el-button link size="small" type="primary" @click="openRole(row)">编辑</el-button>
              <el-button link size="small" type="danger" @click="removeRole(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ========== 权限位（只读） ========== -->
      <el-tab-pane v-if="canArchive" label="权限位" name="permissions">
        <div class="toolbar"><span class="tip">权限位只读；授权在「角色权限」页签维护</span></div>
        <el-table :data="perms" size="small" border stripe max-height="calc(100vh - 230px)">
          <el-table-column prop="code" label="编码" width="150" />
          <el-table-column prop="module" label="模块" width="120" />
          <el-table-column prop="name" label="名称" width="200" />
          <el-table-column label="系统预置" width="100">
            <template #default="{ row }">
              <el-switch v-model="row.preset" :disabled="!canArchive" @change="togglePermPreset(row)" />
            </template>
          </el-table-column>
          <el-table-column prop="desc" label="描述" />
        </el-table>
      </el-tab-pane>

      <!-- ========== 角色权限矩阵 ========== -->
      <el-tab-pane v-if="canSecurity" label="角色权限" name="matrix">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
          title="勾选即生效前需点列头「保存」；权限变更后用户下次登录/刷新档案生效" />
        <div class="toolbar">
          <el-select v-model="matrixProjectFilter" clearable placeholder="按所属项目过滤" style="width:180px" @change="loadMatrix">
            <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
          <span class="tip">按角色所属项目过滤矩阵列</span>
        </div>
        <div class="matrix-wrap">
          <table class="matrix">
            <thead>
              <tr>
                <th class="first">权限位</th>
                <th v-for="r in matrixRoles" :key="r.code">
                  <div class="role-hd">
                    <div>{{ r.code }} {{ r.name }}</div>
                    <div class="role-sub">所属项目：{{ projectLabels(r.projects) || '—' }}</div>
                    <div class="role-sub">{{ rowsOfRole(r.code) }}/{{ perms.length }} 项</div>
                    <div class="role-ops">
                      <el-button link size="small" @click="setRoleAll(r.code)">{{ roleHasAll(r.code) ? '清空' : '全选' }}</el-button>
                      <el-button link size="small" type="primary" :loading="savingRole === r.code" @click="saveRole(r.code)">保存</el-button>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="[mod, list] in permGroups" :key="mod">
                <tr class="group-row">
                  <td :colspan="matrixRoles.length + 1">{{ mod }}</td>
                </tr>
                <tr v-for="p in list" :key="p.code">
                  <td class="first">
                    <span class="code">{{ p.code }}</span>
                    <span class="name">{{ p.name }}</span>
                    <div v-if="p.desc" class="desc">{{ p.desc }}</div>
                  </td>
                  <td v-for="r in matrixRoles" :key="r.code" class="cell">
                    <el-checkbox :model-value="matrix[r.code]?.has(p.code)"
                      @change="(v) => togglePerm(r.code, p.code, v)" />
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </el-tab-pane>

      <!-- ========== 预警规则 ========== -->
      <el-tab-pane v-if="canAlert" label="预警规则" name="alerts">
        <div class="toolbar">
          <el-select v-model="alertsProjectFilter" clearable placeholder="按所属项目过滤" style="width:180px" @change="loadAlerts">
            <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
          <span class="tip">启用后规则在首页工作台「预警事项」实时生效；custTest 的天数为已解决后未完成客户测试的容忍天数</span>
        </div>
        <el-table :data="filteredAlertRules" size="small" border max-height="calc(100vh - 230px)">
          <el-table-column prop="key" label="规则键" width="120" />
          <el-table-column prop="label" label="说明" min-width="220" />
          <el-table-column label="所属项目" min-width="220" :required="requiresProject()">
            <template #default="{ row }">
              <el-select v-model="row.projects" multiple filterable size="small" style="width:100%"
                placeholder="选择所属项目" @change="saveAlertRule(row)">
                <el-option v-for="p in projectSelectOptions" :key="p.value" :value="p.value" :label="p.label" />
              </el-select>
            </template>
          </el-table-column>
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
      <el-tab-pane v-if="canSecurity" label="系统设置" name="settings">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px"
          title="导出上限控制问题列表导出行数；默认密码用于人员档案自动下推生成的用户账号初始密码。" />
        <div class="toolbar">
          <el-select v-model="settingsProjectFilter" clearable placeholder="按所属项目过滤" style="width:180px" @change="onSettingsProjectChange">
            <el-option v-for="p in projectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
          <span class="tip">选择项目后读取该项目的专属设置；未配置时回退为全局值</span>
        </div>
        <el-form label-width="140px" style="max-width: 680px">
          <el-form-item label="所属项目" :required="requiresProject()">
            <el-select v-model="settingsProjects" multiple filterable style="width:100%" placeholder="选择所属项目；留空表示全局设置（仅系统管理员）">
              <el-option v-for="p in projectSelectOptions" :key="p.value" :value="p.value" :label="p.label" />
            </el-select>
          </el-form-item>
          <el-form-item label="导出记录上限">
            <div style="display:flex; align-items:center; gap:12px; width:100%">
              <el-input-number v-model="exportLimit" :min="0" :max="100000" :step="100"
                controls-position="right" style="width: 220px" />
              <span class="tip">0 = 不限制；最大 100000 条</span>
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="settingsSaving" @click="saveIssueExportLimit">保存导出设置</el-button>
          </el-form-item>
          <el-form-item label="默认用户密码">
            <div style="display:flex; align-items:center; gap:12px; width:100%">
              <el-input v-model="defaultPassword" type="password" show-password style="width: 220px"
                placeholder="至少 6 位" />
              <span class="tip">人员新增/修改后下推用户的初始密码</span>
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="passwordSaving" @click="saveDefaultPassword">保存默认密码</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
    <el-empty v-if="!canSecurity && !canArchive && !canAlert" description="当前账号暂无用户与权限相关操作权限" />

    <!-- 用户编辑 -->
    <el-dialog v-model="userDialog" :title="editingUser ? `编辑用户 ${editingUser.username}` : '新增用户'" width="520px">
      <el-form :model="userForm" label-width="90px">
        <el-form-item label="用户名" required>
          <el-input v-model="userForm.username" :disabled="!!editingUser" placeholder="登录账号" />
        </el-form-item>
        <el-form-item :label="editingUser ? '新密码' : '密码'" :required="!editingUser">
          <el-input v-model="userForm.password" type="password" show-password
            :placeholder="editingUser ? '留空则不修改' : '至少 6 位'" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-select v-model="userForm.person" filterable allow-create clearable style="width:100%" placeholder="关联人员档案">
            <el-option v-for="n in personnelNames" :key="n" :value="n" :label="n" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="userForm.role_code" style="width:100%">
            <el-option v-for="r in roles" :key="r.code" :value="r.code" :label="`${r.code} ${r.name}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="所属项目" :required="requiresProject(selectedUserRole)">
          <div style="width:100%">
            <el-checkbox v-if="!auth.scope" v-model="allProjects">全部项目（含新增）</el-checkbox>
            <el-select v-model="userForm.projects" multiple filterable :disabled="allProjects" style="width:100%"
              placeholder="选择所属项目">
              <el-option v-for="p in projectSelectOptions" :key="p.value" :value="p.value" :label="p.label" />
            </el-select>
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
        <el-form-item label="所属项目" :required="requiresProject(roleForm)">
          <el-select v-model="roleForm.projects" multiple filterable style="width:100%" placeholder="选择所属项目；系统管理员角色可留空">
            <el-option v-for="p in projectSelectOptions" :key="p.value" :value="p.value" :label="p.label" />
          </el-select>
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
</style>
