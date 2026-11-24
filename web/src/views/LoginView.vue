<script setup>
import { h, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/store/auth'
import ThemeSwitcher from '@/components/ThemeSwitcher.vue'
import { loginProjects } from '@/api/auth'
import { submitProjectApplication } from '@/api/projectApplications'
import { getRegistrationOptions, registerUser } from '@/api/registration'

const router = useRouter()
const auth = useAuthStore()
const loading = ref(false)
const formRef = ref()
const form = reactive({ username: '', password: '', project: '' })
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}
const projectOptions = ref([])
let lastOptionsKey = ''
let optionsTimer = null
// 账号密码输入后才加载项目，且只展示该账号有权限的项目。
async function loadProjectOptions() {
  if (!form.username || !form.password) {
    projectOptions.value = []
    return
  }
  const key = `${form.username}\u0000${form.password}`
  if (key === lastOptionsKey) return
  lastOptionsKey = key
  try {
    const list = await loginProjects(form.username, form.password)
    projectOptions.value = list
    if (form.project && !list.some((p) => p.code === form.project)) form.project = ''
  } catch {
    projectOptions.value = []
  }
}
watch(() => [form.username, form.password], () => {
  clearTimeout(optionsTimer)
  optionsTimer = setTimeout(loadProjectOptions, 300)
})

// 演示账号一键填充（与种子数据一致）；管理员可不选项目
const demo = [
  { label: '管理员', u: 'admin', p: 'Admin@2026', project: '' },
  { label: '项目经理', u: 'pm.zhang', p: 'Pm@123456', project: 'DMS-2026' },
  { label: '交付顾问', u: 'chen.yongk', p: 'Chen@2026', project: 'DMS-2026' },
  { label: '开发人员', u: 'chen.chao', p: 'Dev@2026', project: 'DMS-2026' },
  { label: '客户测试', u: 'wenqian', p: 'Test@2026', project: 'DMS-2026' },
]
const fill = (d) => { form.username = d.u; form.password = d.p; form.project = d.project || '' }

async function doLogin(forceLogout = false) {
  await auth.login(form.username, form.password, form.project, forceLogout)
  ElMessage.success(`欢迎，${auth.user.person || auth.user.username}`)
  router.push('/home')
}

async function submit() {
  await formRef.value.validate()
  loading.value = true
  try {
    await doLogin()
  } catch (err) {
    const detail = err.body?.details
    if (detail?.code !== 'SESSION_CONFLICT') {
      ElMessage.error(err.message || '登录失败')
    } else {
      const lines = (detail.sessions || []).map((s) =>
        `项目：${s.project || 'ALL'}，登录时间：${new Date(s.login_at).toLocaleString('zh-CN', { hour12: false })}`)
      try {
        await ElMessageBox.confirm(
          `账号 ${form.username} 已在其他位置在线，是否强制下线后继续登录？\n${lines.join('\n')}`,
          '重复登录提示',
          { type: 'warning', confirmButtonText: '强制下线并登录', cancelButtonText: '取消' },
        )
      } catch { return }
      try {
        await doLogin(true)
      } catch (e) {
        ElMessage.error(e.message || '登录失败')
      }
    }
  } finally {
    loading.value = false
  }
}

// ---------- 项目申请（无需登录） ----------
const applyVisible = ref(false)
const applyLoading = ref(false)
const applyFormRef = ref()
const applyForm = reactive({ code: '', name: '', applicant: '', applied_at: '' })
const applyRules = {
  code: [{ required: true, message: '请输入项目编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  applicant: [{ required: true, message: '请输入申请人', trigger: 'blur' }],
  applied_at: [{ required: true, message: '请选择申请时间', trigger: 'change' }],
}
const localNow = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function openApply() {
  Object.assign(applyForm, { code: '', name: '', applicant: '', applied_at: localNow() })
  applyFormRef.value?.clearValidate()
  applyVisible.value = true
}
async function submitApply() {
  await applyFormRef.value.validate()
  applyLoading.value = true
  try {
    await submitProjectApplication({ ...applyForm })
    applyVisible.value = false
    ElMessage.success('申请已提交，待管理员审核通过后生效')
  } catch (err) {
    ElMessage.error(err.message || '提交失败')
  } finally {
    applyLoading.value = false
  }
}

// ---------- 用户注册（无需登录） ----------
const registerVisible = ref(false)
const registerLoading = ref(false)
const registerFormRef = ref()
const registerForm = reactive({ code: '', name: '', role: '', group: '', projects: [] })
const registerOptions = reactive({ roles: [], projects: [] })
const registerRules = {
  code: [
    { required: true, message: '请输入编码', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9_.-]+$/, message: '编码仅允许字母、数字及 . _ -', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  role: [{ required: true, message: '请选择岗位', trigger: 'change' }],
  projects: [{ type: 'array', required: true, min: 1, message: '请选择所属项目', trigger: 'change' }],
}
async function openRegister() {
  Object.assign(registerForm, { code: '', name: '', role: '', group: '', projects: [] })
  registerFormRef.value?.clearValidate()
  registerVisible.value = true
  try {
    const opts = await getRegistrationOptions()
    registerOptions.roles = opts.roles
    registerOptions.projects = opts.projects
  } catch (err) {
    ElMessage.error(err.message || '选项加载失败')
  }
}
async function submitRegister() {
  await registerFormRef.value.validate()
  registerLoading.value = true
  try {
    const data = await registerUser({ ...registerForm })
    registerVisible.value = false
    await ElMessageBox.alert(
      h('div', { style: 'line-height:1.8' }, [
        h('div', null, `注册编码：${data.code}`),
        h('div', null, '注册信息已同步至人员档案，当前状态为“申请中”。'),
        h('div', { style: 'color:#e6a23c' }, '待项目经理或管理员审核通过后，才会生成用户账号并生效。'),
      ]),
      '提交成功', { confirmButtonText: '知道了', type: 'success' },
    )
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') ElMessage.error(err.message || '注册失败')
  } finally {
    registerLoading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="theme-corner"><ThemeSwitcher /></div>
    <el-card class="login-card">
      <h2>问题跟踪系统</h2>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="submit">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="username" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="password" show-password />
        </el-form-item>
        <el-form-item label="项目">
          <el-select v-model="form.project" clearable filterable style="width:100%"
            :disabled="!form.username || !form.password"
            placeholder="输入账号密码后选择项目（管理员可不选）">
            <el-option v-for="p in projectOptions" :key="p.code" :value="p.code" :label="`${p.code} ${p.name}`" />
          </el-select>
        </el-form-item>
        <el-button type="primary" style="width:100%" :loading="loading" @click="submit">登 录</el-button>
        <div class="entry-links">
          <el-button link type="primary" @click="openApply">项目申请</el-button>
          <el-button link type="primary" @click="openRegister">用户注册</el-button>
        </div>
      </el-form>
      <div class="demo">
        <span>演示账号：</span>
        <el-button v-for="d in demo" :key="d.u" size="small" link type="primary" @click="fill(d)">
          {{ d.label }}
        </el-button>
      </div>
    </el-card>

    <el-dialog v-model="applyVisible" title="项目申请" width="460px" destroy-on-close>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
        title="提交后项目档案将标记为“申请中”，管理员审核通过后生效" />
      <el-form ref="applyFormRef" :model="applyForm" :rules="applyRules" label-width="90px">
        <el-form-item label="项目编码" prop="code">
          <el-input v-model="applyForm.code" maxlength="32" placeholder="如 PRJ-2026-001" />
        </el-form-item>
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="applyForm.name" maxlength="128" placeholder="请输入项目名称" />
        </el-form-item>
        <el-form-item label="申请人" prop="applicant">
          <el-input v-model="applyForm.applicant" maxlength="64" placeholder="请输入申请人" />
        </el-form-item>
        <el-form-item label="申请时间" prop="applied_at">
          <el-date-picker v-model="applyForm.applied_at" type="datetime" style="width:100%"
            format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择申请时间" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="applyVisible = false">取消</el-button>
        <el-button type="primary" :loading="applyLoading" @click="submitApply">提交申请</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="registerVisible" title="用户注册" width="480px" destroy-on-close>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
        title="编码、名称、岗位、所属项目必填；提交后进入人员档案待审核，通过后生成用户账号" />
      <el-form ref="registerFormRef" :model="registerForm" :rules="registerRules" label-width="90px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="registerForm.code" maxlength="16" placeholder="登录账号，如 zhang.san" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="registerForm.name" maxlength="64" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="岗位" prop="role">
          <el-select v-model="registerForm.role" placeholder="请选择岗位" style="width:100%">
            <el-option v-for="r in registerOptions.roles" :key="r.code" :value="r.code" :label="r.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="所属组">
          <el-input v-model="registerForm.group" maxlength="64" placeholder="选填" />
        </el-form-item>
        <el-form-item label="所属项目" prop="projects">
          <el-select v-model="registerForm.projects" multiple collapse-tags placeholder="请选择所属项目" style="width:100%">
            <el-option v-for="p in registerOptions.projects" :key="p.code" :value="p.code"
              :label="`${p.code} ${p.name}`" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="registerVisible = false">取消</el-button>
        <el-button type="primary" :loading="registerLoading" @click="submitRegister">注册</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; position: relative; }
.theme-corner { position: absolute; top: 18px; right: 22px; }
.login-card { width: 380px; }
.login-card h2 { margin: 4px 0 16px; text-align: center; }
.entry-links { display: flex; justify-content: space-between; margin-top: 8px; }
.demo { margin-top: 14px; font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
</style>
