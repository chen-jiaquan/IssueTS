import http from './http'

// 列表：多选筛选逗号拼接
export const listIssues = (params) => http.get('/issues', { params })
// 表头筛选候选值（全量数据去重，跨页可选）
export const filterOptions = () => http.get('/issues/filter-options')
export const getIssue = (seq) => http.get(`/issues/${seq}`)
export const createIssue = (data) => http.post('/issues', data)
export const updateIssue = (seq, data) => http.put(`/issues/${seq}`, data)
export const deleteIssue = (seq) => http.delete(`/issues/${seq}`)
export const batchIssues = (seqs, patch) => http.post('/issues/batch', { seqs, patch })
export const batchDeleteIssues = (seqs) => http.post('/issues/batch-delete', { seqs })
export const assignIssue = (seq, field, value) => http.post(`/issues/${seq}/assign`, { field, value })
export const issueLogs = (seq) => http.get(`/issues/${seq}/logs`)
export const queryLogs = (params) => http.get('/logs/query', { params })

// 上传图片（返回 {url,size}）
export const uploadImage = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return http.post('/upload/image', fd)
}

// 导入/导出用原生 fetch（需要原生 FormData/blob 响应）
const authHeader = () => ({ Authorization: `Bearer ${sessionStorage.getItem('access_token')}` })
export const exportIssues = async (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`/api/issues/export?${qs}`, { headers: authHeader() })
  if (!res.ok) throw new Error('导出失败')
  return res.blob()
}
const postFile = async (url, fd) => {
  const res = await fetch(url, { method: 'POST', headers: authHeader(), body: fd })
  const body = await res.json()
  if (body.code !== 0) throw Object.assign(new Error(body.message), { body })
  return body.data
}
export const importFields = () => http.get('/issues/import/fields')
export const readImportHeaders = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return postFile('/api/issues/import/headers', fd)
}
export const importIssues = (file, mapping) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mapping', JSON.stringify(mapping || {}))
  return postFile('/api/issues/import', fd)
}
