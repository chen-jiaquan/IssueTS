import http from './http'

export const listPlans = (params) => http.get('/project-plans', { params })
export const createPlan = (data) => http.post('/project-plans', data)
export const updatePlan = (id, data) => http.put(`/project-plans/${id}`, data)
export const deletePlan = (id) => http.delete(`/project-plans/${id}`)
export const batchSavePlans = (rows) => http.post('/project-plans/batch', { rows })
export const planLogs = (id) => http.get(`/project-plans/${id}/logs`)

export const listCalendars = () => http.get('/project-plans/calendars')
export const saveCalendar = (year, data) => http.put(`/project-plans/calendars/${year}`, data)
export const fetchGovCalendar = (year) => http.get(`/project-plans/calendars/gov/${year}`)

// 导入/导出用原生 fetch（需要原生 FormData/blob 响应）
const authHeader = () => {
  const token = sessionStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}
const postFile = async (url, fd) => {
  const res = await fetch(url, { method: 'POST', headers: authHeader(), body: fd })
  const body = await res.json()
  if (body.code !== 0) throw Object.assign(new Error(body.message || '请求失败'), { body })
  return body.data
}
export const planImportFields = () => http.get('/project-plans/import/fields')
export const readPlanImportHeaders = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return postFile('/api/project-plans/import/headers', fd)
}
export const importPlans = (file, mapping) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mapping', JSON.stringify(mapping || {}))
  return postFile('/api/project-plans/import', fd)
}
export const exportPlans = async (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`/api/project-plans/export?${qs}`, { headers: authHeader() })
  if (!res.ok) throw new Error('导出失败')
  return res.blob()
}
