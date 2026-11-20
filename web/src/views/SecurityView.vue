<script setup>
// 用户与权限：用户管理 + 角色/权限位/预警规则 + 角色权限矩阵 + 系统设置
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import http from '@/api/http'
import { useAuthStore } from '@/store/auth'
import { SECURITY_TAB_PERM } from '@/permissionMenus'
import {
  listUsers, createUser, updateUser, deleteUser,
  listRoles, listPermissions, updatePermission, getRolePerms, putRolePerms,
  getIssueExportLimit, putIssueExportLimit, getDefaultUserPassword, putDefaultUserPassword,
} from '@/api/security'
import {
  createRole, updateRole, deleteRole, listAlertRules, putAlertRule,
} from '@/api/archives'

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
const canSecurity = canUsers || canMatrix || canSettings
const canArchive = canRoles || canPerms
const canAlert = canAlerts
const tab = ref(canUsers ? 'users' : canRoles ? 'roles' : canPerms ? 'permissions'
  : canMatrix ? 'matrix' : canAlerts ? 'alerts' : canSettings ? 'settings' : 'users')

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

const usersProjectFilter = ref([])
const rolesProjectFilter = ref([])

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
  const rows = await getRolePerms()
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
const exportLimit = ref(0)
const defaultPassword = ref('')
const settingsSaving = ref(false)
const passwordSaving = ref(false)

async function loadSettings() {
  if (!canSettings) return
  const [limit, password] = await Promise.all([getIssueExportLimit(), getDefaultUserPassword()])
  exportLimit.value = limit
  defaultPassword.value = password
}

async function saveIssueExportLimit() {
  const value = Number(exportLimit.value)
  if (!Number.isInteger(value) || value < 0 || value > 100000) {
    return ElMessage.warning('导出上限须为 0~100000 的整数')
  }
  settingsSaving.value = true
  try {
    await putIssueExportLimit(value)
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
  passwordSaving.value = true
  try {
    await putDefaultUserPassword(value)
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
    await Promise.all([loadUsers(), loadAllUsers(), loadMatrix(), loadSettings()])
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
        <div class="matrix-wrap">
          <table class="matrix">
            <thead>
              <tr>
                <th class="first">权限位</th>
                <th v-for="r in roles" :key="r.code">
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
                  <td :colspan="roles.length + 1">{{ mod }}</td>
                </tr>
                <tr v-for="p in list" :key="p.code" :class="{ 'no-assign-row': p.no_assign }">
                  <td class="first">
                    <span class="code">{{ p.code }}</span>
                    <span class="name">{{ p.name }}</span>
                    <span v-if="p.no_assign" class="no-assign-tag">禁止分配</span>
                    <div v-if="p.desc" class="desc">{{ p.desc }}</div>
                  </td>
                  <td v-for="r in roles" :key="r.code" class="cell">
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
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px"
          title="导出上限控制问题列表导出行数；默认密码用于人员档案自动下推生成的用户账号初始密码。" />
        <el-form label-width="140px" style="max-width: 560px">
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
