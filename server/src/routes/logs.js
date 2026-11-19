// 全局修改日志查询（见 docs/API契约.md 第 2 节 GET /api/logs/query）
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { attachScope } from '../middleware/scope.js'
import { logsQueryRules } from '../schemas/issues.js'
import { queryLogs } from '../services/issues.js'
import { ok } from '../utils/resp.js'

const router = Router()
router.get('/query', authRequired, loadProfile, hasPerm('ISSUE_LOG'), logsQueryRules, validate, attachScope,
  asyncHandler(async (req, res) => ok(res, await queryLogs(req.query, req.scope))))

export default router
