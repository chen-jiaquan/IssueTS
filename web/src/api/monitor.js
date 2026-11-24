import http from './http'

export const getMonitorStatus = () => http.get('/monitor/status')
export const kickOnlineSession = (id) => http.post(`/monitor/sessions/${id}/kick`)
export const getPortConfig = () => http.get('/monitor/ports')
export const updatePortConfig = (data) => http.put('/monitor/ports', data)
export const getIdleTimeout = () => http.get('/monitor/idle-timeout')
export const updateIdleTimeout = (minutes) => http.put('/monitor/idle-timeout', { minutes })
