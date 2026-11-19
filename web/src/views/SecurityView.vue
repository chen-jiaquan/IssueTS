<script setup>
// 用户与权限：用户管理 + 角色权限矩阵（见 docs/API契约.md 第 5 节）
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import http from '@/api/http'
import { useAuthStore } from '@/store/auth'
import {
  listUsers, createUser, updateUser, deleteUser,
  listRoles, listPermissions, getRolePerms, putRolePerms,
  getIssueExportLimit, putIssueExportLimit,
} from '@/api/security'

const auth = useAuthStore()
const tab = ref('users')

// ---------- 基础数据 ----------
const users = ref([])
const roles = ref([])
const perms = ref([])
const projects = ref([])
const personnelNames = ref([])
const matrix = reactive({}) // role_code -> Set(perm_code)
const savingRole = ref('')

const roleName = (code) => roles.value.find((r) => r.code === code)?.name ?? code
const roleColor = (code) => roles.value.find((r) => r.code === code)?.color

async function loadBase() {
  const [r, p, prj, pers] = await Promise.all([
    listRoles(),
    listPermissions(),
    http.get('/archives/projects'),
    http.get('/archives/personnel'),
  ])
  roles.value = r
  perms.value = p
  projects.value = prj
  personnelNames.value = pers.map((x) => x.name)
}

async function loadUsers() {
  users.value = await listUsers()
}

async function loadMatrix() {
  const rows = await getRolePerms()
  for (const r of roles.value) matrix[r.code] = new Set()
  for (const row of rows) (matrix[row.role_code] ??= new Set()).add(row.perm_code)
}

// ---------- 用户表单 ----------
const userDialog = ref(false)
const editingUser = ref(null)
const userForm = reactive({ username: '', password: '', person: '', role_code: '', status: '启用', projects: [] })
const allProjects = ref(false)

const projectLabels = computed(() => projects.value.map((p) => `${p.code} ${p.name}`))

function openUser(row = null) {
  editingUser.value = row
  allProjects.value = !!row?.projects?.includes('ALL')
  Object.assign(userForm, row
    ? { username: row.username, password: '', person: row.person || '', role_code: row.role_code, status: row.status, projects: allProjects.value ? [] : [...(row.projects || [])] }
    : { username: '', password: '', person: '', role_code: roles.value[0]?.code ?? '', status: '启用', projects: [] })
  userDialog.value = true
}

async function saveUser() {
  if (!userForm.username.trim()) return ElMessage.warning('用户名必填')
  if (!userForm.role_code) return ElMessage.warning('角色必填')
  if (!editingUser.value && (userForm.password || '').length < 6) return ElMessage.warning('密码至少 6 位')
  const payload = { ...userForm, projects: allProjects.value ? ['ALL'] : userForm.projects }
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
const settingsSaving = ref(false)

async function loadSettings() {
  if (!auth.has('SECURITY_MGR')) return
  exportLimit.value = await getIssueExportLimit()
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

onMounted(async () => {
  await loadBase()
  await Promise.all([loadUsers(), loadMatrix(), loadSettings()])
})
</script>

<template>
  <div style="padding: 14px 20px 30px">
    <div style="margin-bottom:10px"><BackHome /></div>
    <el-tabs v-model="tab">
      <!-- ========== 用户管理 ========== -->
      <el-tab-pane label="用户管理" name="users">
        <div class="toolbar">
          <el-button type="primary" @click="openUser()">新增用户</el-button>
          <span class="tip">共 {{ users.length }} 个账号（密码 bcrypt 存储，不回显）</span>
        </div>
        <el-table :data="users" size="small" border stripe>
          <el-table-column prop="username" label="用户名" width="130" />
          <el-table-column prop="person" label="姓名" width="110" />
          <el-table-column label="角色" width="140">
            <template #default="{ row }">
              <el-tag size="small" :color="roleColor(row.role_code) + '22'" :style="{ color: roleColor(row.role_code), borderColor: roleColor(row.role_code) }">
                {{ row.role_code }} {{ row.role_name }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="可见项目" min-width="200">
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

      <!-- ========== 角色权限矩阵 ========== -->
      <el-tab-pane label="角色权限" name="matrix">
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
                  <td :colspan="roles.length + 1">{{ mod }}</td>
                </tr>
                <tr v-for="p in list" :key="p.code">
                  <td class="first">
                    <span class="code">{{ p.code }}</span>
                    <span class="name">{{ p.name }}</span>
                    <div v-if="p.desc" class="desc">{{ p.desc }}</div>
                  </td>
                  <td v-for="r in roles" :key="r.code" class="cell">
                    <el-checkbox :model-value="matrix[r.code]?.has(p.code)"
                      @change="(v) => togglePerm(r.code, p.code, v)" />
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </el-tab-pane>

      <!-- ========== 系统设置 ========== -->
      <el-tab-pane v-if="auth.has('SECURITY_MGR')" label="系统设置" name="settings">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px"
          title="问题列表 Excel 导出的最大记录数；0 表示不限制，将按当前筛选条件导出全部记录。" />
        <el-form label-width="140px" style="max-width: 560px">
          <el-form-item label="导出记录上限">
            <div style="display:flex; align-items:center; gap:12px; width:100%">
              <el-input-number v-model="exportLimit" :min="0" :max="100000" :step="100"
                controls-position="right" style="width: 220px" />
              <span class="tip">0 = 不限制；最大 100000 条</span>
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="settingsSaving" @click="saveIssueExportLimit">保存设置</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

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
        <el-form-item label="可见项目">
          <div style="width:100%">
            <el-checkbox v-model="allProjects">全部项目（含新增）</el-checkbox>
            <el-select v-if="!allProjects" v-model="userForm.projects" multiple filterable style="width:100%"
              placeholder="选择可见项目">
              <el-option v-for="p in projects" :key="p.code" :value="p.code" :label="`${p.code} ${p.name}`" />
            </el-select>
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="userForm.status">
            <el-radio value="启用">启用</el-radio>
            <el-radio value="停用">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userDialog = false">取消</el-button>
        <el-button type="primary" @click="saveUser">保存</el-button>
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
