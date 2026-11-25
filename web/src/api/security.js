import http from './http'

const projectParams = (project) => {
  const codes = Array.isArray(project) ? project : (project ? [project] : [])
  return codes.length ? { params: { project: codes.join(',') } } : {}
}

// 用户（SECURITY_TAB_USERS）
export const listUsers = (project) => http.get('/archives/users', projectParams(project))
export const createUser = (data) => http.post('/archives/users', data)
export const updateUser = (id, data) => http.put(`/archives/users/${id}`, data)
export const deleteUser = (id) => http.delete(`/archives/users/${id}`)

// 角色 / 权限（按二级菜单权限位）
export const listRoles = (project) => http.get('/archives/roles', projectParams(project))
export const listPermissions = () => http.get('/archives/permissions')
export const updatePermission = (code, data) => http.put(`/archives/permissions/${code}`, data)
export const getRolePerms = (project) => http.get('/archives/role-permissions', projectParams(project))
export const putRolePerms = (roleCode, permCodes) =>
  http.put('/archives/role-permissions', { role_code: roleCode, perm_codes: permCodes })

// 系统设置（SECURITY_TAB_SETTINGS）
export const getIssueExportLimit = (project) => http.get('/config/settings/issue-export-limit', projectParams(project))
export const putIssueExportLimit = (value, projects) =>
  http.put('/config/settings/issue-export-limit', { value, projects })
export const getPlanExportLimit = (project) => http.get('/config/settings/plan-export-limit', projectParams(project))
export const putPlanExportLimit = (value, projects) =>
  http.put('/config/settings/plan-export-limit', { value, projects })
export const getReportExportLimit = (project) => http.get('/config/settings/report-export-limit', projectParams(project))
export const putReportExportLimit = (value, projects) =>
  http.put('/config/settings/report-export-limit', { value, projects })
export const getDefaultUserPassword = (project) => http.get('/config/settings/default-user-password', projectParams(project))
export const putDefaultUserPassword = (value, projects) =>
  http.put('/config/settings/default-user-password', { value, projects })
export const getTodoDueDays = (project) => http.get('/config/settings/todo-due-days', projectParams(project))
export const putTodoDueDays = (value, projects) =>
  http.put('/config/settings/todo-due-days', { value, projects })
export const getTodoStatuses = (project) => http.get('/config/settings/todo-statuses', projectParams(project))
export const putTodoStatuses = (value, projects) =>
  http.put('/config/settings/todo-statuses', { value, projects })
