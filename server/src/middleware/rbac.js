// RBAC：权限位校验（数据模型 20 项权限位，见 docs/数据模型.md）
import { fail, ERR } from '../utils/resp.js'

// 用法: router.post('/', authRequired, loadProfile, hasPerm('ISSUE_CREATE'), handler)
export function hasPerm(code) {
  return (req, res, next) => {
    const perms = req.profile?.perms || []
    if (!perms.includes(code)) {
      return fail(res, 403, ERR.FORBIDDEN, `无权限：${code}`)
    }
    next()
  }
}
