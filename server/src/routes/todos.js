// 待办端点（见 docs/API契约.md 第 4 节 /api/todos）
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { todoBody, idParam } from '../schemas/stats.js'
import * as H from '../services/home.js'
import { ok } from '../utils/resp.js'

const router = Router()
router.use(authRequired, loadProfile)

router.get('/', hasPerm('DASH_VIEW'), asyncHandler(async (_req, res) => ok(res, await H.listTodos())))

router.post('/', hasPerm('DASH_TODO'), todoBody, validate,
  asyncHandler(async (req, res) => ok(res, await H.createTodo(req.body))))

router.put('/:id', hasPerm('DASH_TODO'), idParam, todoBody, validate,
  asyncHandler(async (req, res) => ok(res, await H.updateTodo(req.params.id, req.body))))

router.delete('/:id', hasPerm('DASH_TODO'), idParam, validate,
  asyncHandler(async (req, res) => { await H.deleteTodo(req.params.id); ok(res) }))

export default router
