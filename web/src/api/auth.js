import http from './http'

export const login = (username, password) => http.post('/auth/login', { username, password })
export const logout = (refreshToken) => http.post('/auth/logout', { refreshToken })
export const me = () => http.get('/auth/me')
