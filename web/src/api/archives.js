import http from './http'

// 项目 / 产品 / 人员 / 字典 / 角色（写操作需 ARCHIVE_MGR，由后端 RBAC 把关）
export const listProjects = () => http.get('/archives/projects')
export const createProject = (d) => http.post('/archives/projects', d)
export const updateProject = (code, d) => http.put(`/archives/projects/${code}`, d)
export const deleteProject = (code) => http.delete(`/archives/projects/${code}`)

export const listProducts = () => http.get('/archives/products')
export const createProduct = (d) => http.post('/archives/products', d)
export const updateProduct = (code, d) => http.put(`/archives/products/${code}`, d)
export const deleteProduct = (code) => http.delete(`/archives/products/${code}`)

export const listPersonnel = () => http.get('/archives/personnel')
export const createPersonnel = (d) => http.post('/archives/personnel', d)
export const updatePersonnel = (code, d) => http.put(`/archives/personnel/${code}`, d)
export const deletePersonnel = (code) => http.delete(`/archives/personnel/${code}`)

// 人员档案导入/导出（原生 fetch：需要 blob 响应与原生 FormData）
const authHeader = () => ({ Authorization: `Bearer ${sessionStorage.getItem('access_token')}` })
export const exportPersonnel = async () => {
  const res = await fetch('/api/archives/personnel/export', { headers: authHeader() })
  if (!res.ok) throw new Error('导出失败')
  return res.blob()
}
const postPersonnelFile = async (url, fd) => {
  const res = await fetch(url, { method: 'POST', headers: authHeader(), body: fd })
  const body = await res.json()
  if (body.code !== 0) throw Object.assign(new Error(body.message), { body })
  return body.data
}
export const personnelImportFields = () => http.get('/archives/personnel/import/fields')
export const readPersonnelHeaders = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return postPersonnelFile('/api/archives/personnel/import/headers', fd)
}
export const importPersonnel = (file, mapping) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mapping', JSON.stringify(mapping || {}))
  return postPersonnelFile('/api/archives/personnel/import', fd)
}

export const listDictItems = (dictKey) =>
  http.get('/archives/dict-items', dictKey ? { params: { dict_key: dictKey } } : {})
export const createDictItem = (d) => http.post('/archives/dict-items', d)
export const updateDictItem = (id, d) => http.put(`/archives/dict-items/${id}`, d)
export const deleteDictItem = (id) => http.delete(`/archives/dict-items/${id}`)

export const listCustomFields = () => http.get('/archives/custom-fields')
export const createCustomField = (d) => http.post('/archives/custom-fields', d)
export const updateCustomField = (key, d) => http.put(`/archives/custom-fields/${key}`, d)
export const deleteCustomField = (key) => http.delete(`/archives/custom-fields/${key}`)

export const getRequiredFields = (project) =>
  http.get('/archives/required-fields', project ? { params: { project } } : {})
export const getRequiredFieldRules = () => http.get('/archives/required-fields/rules')
export const putRequiredFields = (fields) => http.put('/archives/required-fields', { fields })

export const listNoticeTypes = () => http.get('/archives/notice-types')
export const createNoticeType = (d) => http.post('/archives/notice-types', d)
export const updateNoticeType = (id, d) => http.put(`/archives/notice-types/${id}`, d)
export const deleteNoticeType = (id) => http.delete(`/archives/notice-types/${id}`)

export const listTodoPrios = () => http.get('/archives/todo-prios')
export const createTodoPrio = (d) => http.post('/archives/todo-prios', d)
export const updateTodoPrio = (code, d) => http.put(`/archives/todo-prios/${code}`, d)
export const deleteTodoPrio = (code) => http.delete(`/archives/todo-prios/${code}`)

export const listAlertRules = (project) => http.get('/archives/alert-rules', project ? { params: { project } } : {})
export const putAlertRule = (d) => http.put('/archives/alert-rules', d)

export const listRoles = () => http.get('/archives/roles')
export const createRole = (d) => http.post('/archives/roles', d)
export const updateRole = (code, d) => http.put(`/archives/roles/${code}`, d)
export const deleteRole = (code) => http.delete(`/archives/roles/${code}`)
