// 图片上传（见 docs/API契约.md 第 7 节）：multipart 字段 file，image/*，≤5MB
import { Router } from 'express'
import crypto from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { asyncHandler } from '../middleware/error.js'
import { authRequired, loadProfile } from '../middleware/auth.js'
import { hasPerm } from '../middleware/rbac.js'
import { uploadImage } from '../services/excel.js'
import { config } from '../config/index.js'
import { ok, fail, ERR } from '../utils/resp.js'

const router = Router()
router.use(authRequired)

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }

router.post('/image', loadProfile, (req, res, next) => {
  // ISSUE_CREATE 或 ISSUE_EDIT 任一即可上传
  if (!req.profile.perms.some((p) => ['ISSUE_CREATE', 'ISSUE_EDIT'].includes(p))) {
    return fail(res, 403, ERR.FORBIDDEN, '无权限：ISSUE_UPLOAD')
  }
  uploadImage(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 400, ERR.VALIDATION, '图片不能超过 5MB')
      return next(err)
    }
    next()
  })
}, asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, 400, ERR.VALIDATION, '缺少 file 字段')
  const ext = EXT[req.file.mimetype] ?? (path.extname(req.file.originalname || '') || '.bin')
  await mkdir(config.uploadDir, { recursive: true })
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`
  await writeFile(path.join(config.uploadDir, name), req.file.buffer)
  ok(res, { url: `/uploads/${name}`, size: req.file.size })
}))

export default router
