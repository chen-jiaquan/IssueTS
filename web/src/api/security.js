import http from './http'

// 用户（SECURITY_MGR）
export const listUsers = () => http.get('/archives/users')
export const createUser = (data) => http.post('/archives/users', data)
export const updateUser = (id, data) => http.put(`/archives/users/${id}`, data)
export const deleteUser = (id) => http.delete(`/archives/users/${id}`)

// 角色 / 权限（读取 ARCHIVE_MGR；矩阵读写 SECURITY_MGR）
export const listRoles = () => http.get('/archives/roles')
export const listPermissions = () => http.get('/archives/permissions')
export const getRolePerms = () => http.get('/archives/role-permissions')
export const putRolePerms = (roleCode, permCodes) =>
  http.put('/archives/role-permissions', { role_code: roleCode, perm_codes: permCodes })

// 系统设置（SECURITY_MGR）
export const getIssueExportLimit = () => http.get('/config/settings/issue-export-limit')
export const putIssueExportLimit = (value) => http.put('/config/settings/issue-export-limit', { value })
