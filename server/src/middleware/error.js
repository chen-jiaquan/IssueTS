import { fail, ERR } from '../utils/resp.js'

export function notFound(req, res) {
  fail(res, 404, ERR.NOT_FOUND, '接口不存在', { path: req.originalUrl })
}

export function errorHandler(err, req, res, _next) {
  // HttpError：业务异常（含 code/details）
  if (err.httpStatus) {
    return fail(res, err.httpStatus, err.code ?? ERR.SERVER, err.message, err.details)
  }
  const status = err.status || err.statusCode || 500
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err.stack || err.message)
  }
  fail(res, status, status >= 500 ? ERR.SERVER : err.code ?? status,
    status >= 500 ? '服务器内部错误' : err.message)
}

// async 路由包装，异常自动进入 errorHandler
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}
