import axios from 'axios'

// axios 实例：baseURL 来自环境变量（.env: VITE_API_BASE，默认走 Vite 代理）
const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 15000,
})

export const tokens = {
  get access() { return sessionStorage.getItem('access_token') },
  get refresh() { return sessionStorage.getItem('refresh_token') },
  save(access, refresh) {
    sessionStorage.setItem('access_token', access)
    if (refresh) sessionStorage.setItem('refresh_token', refresh)
  },
  clear() {
    sessionStorage.removeItem('access_token')
    sessionStorage.removeItem('refresh_token')
  },
}

http.interceptors.request.use((cfg) => {
  if (tokens.access) cfg.headers.Authorization = `Bearer ${tokens.access}`
  return cfg
})

// 统一解包 {code,message,data}；401 时静默刷新一次后重试原请求
http.interceptors.response.use(
  (res) => {
    const body = res.data
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0) return Promise.reject(Object.assign(new Error(body.message || '请求失败'), { body }))
      return body.data
    }
    return body
  },
  async (err) => {
    const cfg = err.config
    if (err.response?.status === 401 && cfg && !cfg._retried) {
      cfg._retried = true
      const rt = tokens.refresh
      if (rt) {
        try {
          // 裸 axios 避免递归拦截器
          const { data } = await axios.post(
            `${cfg.baseURL}/auth/refresh`,
            { refreshToken: rt },
            { timeout: 15000 },
          )
          if (data.code === 0) {
            tokens.save(data.data.accessToken)
            return http(cfg)
          }
        } catch { /* 刷新失败走清退流程 */ }
      }
      tokens.clear()
    }
    const body = err.response?.data
    return Promise.reject(Object.assign(
      new Error(body?.message || err.message || '网络错误'),
      { body, status: err.response?.status },
    ))
  },
)

export default http
