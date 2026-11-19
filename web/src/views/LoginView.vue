<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/store/auth'
import ThemeSwitcher from '@/components/ThemeSwitcher.vue'

const router = useRouter()
const auth = useAuthStore()
const loading = ref(false)
const formRef = ref()
const form = reactive({ username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

// 演示账号一键填充（与种子数据一致）
const demo = [
  { label: '管理员', u: 'admin', p: 'Admin@2026' },
  { label: '项目经理', u: 'pm.zhang', p: 'Pm@123456' },
  { label: '交付顾问', u: 'chen.yongk', p: 'Chen@2026' },
  { label: '开发人员', u: 'chen.chao', p: 'Dev@2026' },
  { label: '客户测试', u: 'wenqian', p: 'Test@2026' },
]
const fill = (d) => { form.username = d.u; form.password = d.p }

async function submit() {
  await formRef.value.validate()
  loading.value = true
  try {
    await auth.login(form.username, form.password)
    ElMessage.success(`欢迎，${auth.user.person || auth.user.username}`)
    router.push('/home')
  } catch (err) {
    ElMessage.error(err.message || '登录失败')
  } finally {
    loading.value = false
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
        <el-button type="primary" style="width:100%" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
      <div class="demo">
        <span>演示账号：</span>
        <el-button v-for="d in demo" :key="d.u" size="small" link type="primary" @click="fill(d)">
          {{ d.label }}
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; position: relative; }
.theme-corner { position: absolute; top: 18px; right: 22px; }
.login-card { width: 380px; }
.login-card h2 { margin: 4px 0 16px; text-align: center; }
.demo { margin-top: 14px; font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
</style>
