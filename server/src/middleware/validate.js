import { validationResult } from 'express-validator'
import { fail, ERR } from '../utils/resp.js'

// express-validator 结果处理：失败返回 40001 + 字段明细
export function validate(req, res, next) {
  const result = validationResult(req)
  if (!result.isEmpty()) {
    return fail(res, 400, ERR.VALIDATION, '参数校验失败',
      result.array().map((e) => ({ field: e.path, message: e.msg })))
  }
  next()
}
