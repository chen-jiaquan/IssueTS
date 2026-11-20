import http from './http'

export const listPlans = (params) => http.get('/project-plans', { params })
export const createPlan = (data) => http.post('/project-plans', data)
export const updatePlan = (id, data) => http.put(`/project-plans/${id}`, data)
export const deletePlan = (id) => http.delete(`/project-plans/${id}`)

const authHeader = () => {
  const token = sessionStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function importPlans(file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/project-plans/import', { method: 'POST', headers: authHeader(), body: fd })
  const body = await res.json()
  if (!res.ok || body.code !== 0) throw Object.assign(new Error(body.message || '导入失败'), { body })
  return body.data
}

export async function downloadPlanTemplate() {
  const res = await fetch('/api/project-plans/template', { headers: authHeader() })
  if (!res.ok) throw new Error('模板下载失败')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '项目计划导入模板.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}
