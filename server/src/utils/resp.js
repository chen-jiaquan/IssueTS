// 统一响应包裹与错误码（见 docs/API契约.md 第 0 节）
import crypto from 'node:crypto'

export const ERR = {
  VALIDATION: 40001, // 400 参数校验失败
  UNAUTHORIZED: 40101, // 401 未登录/令牌失效
  FORBIDDEN: 40301, // 403 权限位不足/账号停用
  SCOPE: 40302, // 403 数据范围越界
  NOT_FOUND: 40401,
  CONFLICT: 40901,
  SERVER: 50000,
}

export function ok(res, data = null, message = 'ok') {
  res.json({ code: 0, message, data, requestId: crypto.randomUUID() })
}

export function fail(res, httpStatus, code, message, details) {
  res.status(httpStatus).json({ code, message, ...(details ? { details } : {}), requestId: crypto.randomUUID() })
}

// 业务异常：throw new HttpError(401, ERR.UNAUTHORIZED, '令牌失效')
export class HttpError extends Error {
  constructor(httpStatus, code, message, details) {
    super(message)
    this.httpStatus = httpStatus
    this.code = code
    this.details = details
  }
}
