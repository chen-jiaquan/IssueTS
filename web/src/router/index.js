import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/store/auth'
import { ARCHIVE_ENTRY_PERMS, SECURITY_ENTRY_PERMS } from '@/permissionMenus'

const routes = [
  { path: '/', redirect: '/home' },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
  { path: '/home', name: 'home', component: () => import('@/views/HomeView.vue') },
  {
    path: '/todo-list', name: 'todo-list', component: () => import('@/views/TodoListView.vue'),
    meta: { perms: ['DASH_VIEW'] },
  },
  {
    path: '/archives', name: 'archives', component: () => import('@/views/ArchivesView.vue'),
    meta: { perms: ARCHIVE_ENTRY_PERMS },
  },
  {
    path: '/plan', name: 'plan', component: () => import('@/views/PlanView.vue'),
    meta: { perms: ['ISSUE_VIEW'] },
  },
  {
    path: '/issues', name: 'issues', component: () => import('@/views/IssuesView.vue'),
    meta: { perms: ['ISSUE_VIEW'] },
  },
  {
    path: '/stats', name: 'stats', component: () => import('@/views/StatsView.vue'),
    meta: { perms: ['ISSUE_VIEW'] },
  },
  {
    path: '/security', name: 'security', component: () => import('@/views/SecurityView.vue'),
    meta: { perms: SECURITY_ENTRY_PERMS },
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 登录 + 一级入口权限守卫；有令牌无档案先拉取 /me
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (to.name === 'login') return auth.isLoggedIn ? '/home' : true
  if (!sessionStorage.getItem('access_token')) return { name: 'login' }
  if (!auth.user) {
    await auth.fetchMe()
    if (!auth.user) return { name: 'login' }
  }
  if (to.meta?.perms && !auth.has(to.meta.perms)) return { name: 'home' }
  return true
})

export default router
