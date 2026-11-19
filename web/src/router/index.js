import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/store/auth'

const routes = [
  { path: '/', redirect: '/home' },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
  { path: '/home', name: 'home', component: () => import('@/views/HomeView.vue') },
  { path: '/archives', name: 'archives', component: () => import('@/views/ArchivesView.vue') },
  { path: '/issues', name: 'issues', component: () => import('@/views/IssuesView.vue') },
  { path: '/stats', name: 'stats', component: () => import('@/views/StatsView.vue') },
  { path: '/security', name: 'security', component: () => import('@/views/SecurityView.vue') },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
]

// 后续模块路由（问题/统计/档案/权限）在此追加，与侧栏菜单一一对应
const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 登录守卫：未登录跳登录页；有令牌无档案先拉取 /me
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (to.name === 'login') return auth.isLoggedIn ? '/home' : true
  if (!sessionStorage.getItem('access_token')) return { name: 'login' }
  if (!auth.user) {
    await auth.fetchMe()
    if (!auth.user) return { name: 'login' }
  }
  return true
})

export default router
