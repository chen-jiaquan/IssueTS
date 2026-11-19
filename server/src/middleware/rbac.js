// RBAC：权限位校验（数据模型 20 项权限位，见 docs/数据模型.md）
import { fail, ERR } from '../utils/resp.js'

// 用法: router.post('/', authRequired, loadProfile, hasPerm('ISSUE_CREATE'), handler)
// 传入数组表示满足任一权限即可，如 hasPerm(['ARCHIVE_MGR', 'SECURITY_MGR'])
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
