import { defineStore } from 'pinia'
import { login as apiLogin, logout as apiLogout, me as apiMe } from '@/api/auth'
import { tokens } from '@/api/http'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null, // { id, username, person, role, perms: [], projects: []|['ALL'] }
  }),
  getters: {
    isLoggedIn: (s) => !!s.user,
    perms: (s) => s.user?.perms ?? [],
    // ALL 或具 PROJECT_ALL 权限则可见全部项目
    scope: (s) => {
      if (!s.user) return []
      if (s.user.projects.includes('ALL') || s.user.perms.includes('PROJECT_ALL')) return null
      return s.user.projects
    },
  },
  actions: {
    has(perm) {
      return this.perms.includes(perm)
    },
    async login(username, password) {
      const data = await apiLogin(username, password)
      tokens.save(data.accessToken, data.refreshToken)
      this.user = data.user
      return data.user
    },
    // 应用启动/路由守卫调用：有令牌但无档案时拉取
    async fetchMe() {
      if (!tokens.access) return null
      try {
        this.user = await apiMe()
        return this.user
      } catch {
        tokens.clear()
        this.user = null
        return null
      }
    },
    async logout() {
      try { await apiLogout(tokens.refresh) } catch { /* 令牌已失效视为登出成功 */ }
      tokens.clear()
      this.user = null
    },
  },
})
