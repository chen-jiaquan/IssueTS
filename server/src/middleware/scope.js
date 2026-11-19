// 数据范围（可见项目）：用户 projects 含 "ALL" 或具 PROJECT_ALL 权限则不受限
// 其余情况：req.scope = 项目编码数组，问题/统计/导出类查询自动附加 project IN (...)
import { HttpError, ERR } from '../utils/resp.js'

export function attachScope(req, _res, next) {
  const p = req.profile
  const all = p.projects.includes('ALL') || p.perms.includes('PROJECT_ALL')
  req.scope = all ? null : p.projects
  next()
}

// 单项目可见性校验（写操作前调用）
export function assertProjectVisible(req, project) {
  if (req.scope && !req.scope.includes(project)) {
    throw new HttpError(403, ERR.SCOPE, `无权访问项目：${project}`)
  }
}
