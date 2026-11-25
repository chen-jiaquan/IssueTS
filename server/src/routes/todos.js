// 待办端点（见 docs/API契约.md 第 4 节 /api/todos）
import { Router } from 'express'
import { asyncHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { attachScope, assertProjectVisible } from '../middleware/scope.js'
import { hasPerm } from '../middleware/rbac.js'
import { todoBody, idParam, aggregateTodoQuery } from '../schemas/stats.js'
import * as H from '../services/home.js'
import { ok } from '../utils/resp.js'

const router = Router()
router.use(authRequired, loadProfile, attachScope)

router.get('/', hasPerm('DASH_VIEW'), asyncHandler(async (req, res) => ok(res, await H.listTodos(req.scope, req.profile))))

// 聚合待办：问题 + 项目计划 + 手工待办，按类型分类，截止日期在未来一周内（含逾期）
router.get('/aggregate', hasPerm('DASH_VIEW'), aggregateTodoQuery, validate,
  asyncHandler(async (req, res) => ok(res, await H.listAggregatedTodos(req.scope, req.query, req.profile))))

router.post('/', hasPerm('DASH_TODO'), todoBody, validate,
  asyncHandler(async (req, res) => {
    for (const project of req.body.projects || []) assertProjectVisible(req, project)
    ok(res, await H.createTodo(req.body))
  }))

router.put('/:id', hasPerm('DASH_TODO'), idParam, todoBody, validate,
  asyncHandler(async (req, res) => {
    for (const project of req.body.projects || []) assertProjectVisible(req, project)
    ok(res, await H.updateTodo(req.params.id, req.body))
  }))

router.delete('/:id', hasPerm('DASH_TODO'), idParam, validate,
  asyncHandler(async (req, res) => {
    for (const project of await H.getTodoProjects(req.params.id)) assertProjectVisible(req, project)
    await H.deleteTodo(req.params.id); ok(res)
  }))

export default router
