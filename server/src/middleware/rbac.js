// RBAC：权限位校验（数据模型 20 项权限位，见 docs/数据模型.md）
import { fail, ERR } from '../utils/resp.js'
import { isSystemAdminRole } from './scope.js'

// 用法: router.post('/', authRequired, loadProfile, hasPerm('ISSUE_CREATE'), handler)
// 传入数组表示满足任一权限即可，如 hasPerm(['SECURITY_TAB_ROLES', 'SECURITY_TAB_USERS'])
export function hasPerm(code) {
  const codes = Array.isArray(code) ? code : [code]
  return (req, res, next) => {
    const perms = req.profile?.perms || []
    if (!codes.some((c) => perms.includes(c))) {
      return fail(res, 403, ERR.FORBIDDEN, `无权限：${codes.join(' 或 ')}`)
    }
    next()
  }
}

// 仅系统管理员角色（R01/管理员）可操作，用于权限位菜单等收敛场景。
export function systemAdminOnly(req, res, next) {
  const p = req.profile
  if (!isSystemAdminRole(p?.role_code, p?.role)) {
    return fail(res, 403, ERR.FORBIDDEN, '仅系统管理员角色可操作')
  }
  next()
}

// 注册审核人：项目经理（R02）或管理员（R01）。
export const isRegistrationReviewer = (profile) =>
  isSystemAdminRole(profile?.role_code, profile?.role)
  || profile?.role_code === 'R02' || profile?.role === '项目经理'

export function registrationReviewerOnly(req, res, next) {
  if (!isRegistrationReviewer(req.profile)) {
    return fail(res, 403, ERR.FORBIDDEN, '仅项目经理或管理员可审核注册申请')
  }
  next()
}
