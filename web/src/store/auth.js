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
    // 可见项目范围：用户档案显式配置的项目优先；仅当未配置项目(空)时才用 PROJECT_ALL 兜底
    scope: (s) => {
      if (!s.user) return []
      const projects = s.user.projects || []
      if (projects.includes('ALL')) return null
      if (projects.length) return projects
      return s.user.perms.includes('PROJECT_ALL') ? null : []
    },
  },
  actions: {
    has(perm) {
      if (Array.isArray(perm)) return perm.some((p) => this.perms.includes(p))
      return this.perms.includes(perm)
    },
    async login(username, password, project) {
      const data = await apiLogin(username, password, project)
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
