import http from './http'

// 登录页项目申请（公开提交）与管理端审核
export const submitProjectApplication = (d) => http.post('/project-applications', d)
export const reviewProjectApplication = (code, d) =>
  http.put(`/project-applications/${encodeURIComponent(code)}/review`, d)
