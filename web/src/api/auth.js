import http from './http'

export const loginProjects = (username, password) =>
  http.post('/auth/login-projects', { username, password })
export const login = (username, password, project) =>
  http.post('/auth/login', { username, password, project: project || '' })
export const logout = (refreshToken) => http.post('/auth/logout', { refreshToken })
export const me = () => http.get('/auth/me')
