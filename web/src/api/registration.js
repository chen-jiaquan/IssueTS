import http from './http'

// 登录页用户注册（公开）
export const getRegistrationOptions = () => http.get('/registration/options')
export const registerUser = (d) => http.post('/registration', d)
export const reviewRegistration = (code, d) =>
  http.put(`/registration/${encodeURIComponent(code)}/review`, d)
