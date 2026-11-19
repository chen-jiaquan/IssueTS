// 数据范围（可见项目）：用户档案显式配置的项目优先；仅当未配置项目(空)时才用 PROJECT_ALL 权限兜底
// 其余情况：req.scope = 项目编码数组，问题/统计/导出类查询自动附加 project IN (...)
import { HttpError, ERR } from '../utils/resp.js'

export const SYSTEM_ADMIN_ROLE_CODE = 'R01'
export const SYSTEM_ADMIN_ROLE_NAME = '管理员'

export const isSystemAdminRole = (roleCode, roleName) =>
  roleCode === SYSTEM_ADMIN_ROLE_CODE || roleName === SYSTEM_ADMIN_ROLE_NAME

export function attachScope(req, _res, next) {
  const p = req.profile
  const projects = p.projects || []
  if (projects.includes('ALL')) req.scope = null
  else if (projects.length) req.scope = projects
  else req.scope = p.perms.includes('PROJECT_ALL') ? null : []
  next()
}

// 单项目可见性校验（写操作前调用）
export function assertProjectVisible(req, project) {
  if (req.scope && !req.scope.includes(project)) {
    throw new HttpError(403, ERR.SCOPE, `无权访问项目：${project}`)
  }
}

// 多项目档案写校验：scope 受限用户提交的 projects 不能超出其可见项目
export function assertProjectsEditable(req, projects) {
  if (!req.scope || !Array.isArray(projects)) return
  const bad = projects.find((p) => p !== 'ALL' && !req.scope.includes(p))
  if (bad) throw new HttpError(403, ERR.SCOPE, `无权维护项目：${bad}`)
}

// 系统管理员角色可不填所属项目；其余角色（或被编辑的目标角色）必须填写。
// target 不传时按当前登录用户角色判断，用于预警规则/系统设置等无独立角色字段的对象。
export function assertProjectsRequired(req, projects, target = {}) {
  const roleCode = target.role_code ?? target.code ?? req?.profile?.role_code
  const roleName = target.role_name ?? target.name ?? req?.profile?.role
  if (!isSystemAdminRole(roleCode, roleName)) {
    const list = Array.isArray(projects) ? projects : []
    if (!list.length) throw new HttpError(400, ERR.VALIDATION, '所属项目必填', [{ field: 'projects' }])
  }
  assertProjectsEditable(req, projects)
}
