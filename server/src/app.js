import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from './config/index.js'
import { pool } from './db/pool.js'
import routes from './routes/index.js'
import { notFound, errorHandler } from './middleware/error.js'

const app = express()
app.disable('x-powered-by')
app.use(cors())
app.use(express.json({ limit: '10mb' }))
if (config.env !== 'test') app.use(morgan(':method :url :status :res[content-length]B - :response-time ms'))

// 健康检查（Docker healthcheck 使用）
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ code: 0, data: { status: 'ok', db: 'up', uptime: process.uptime() } })
  } catch (err) {
    res.status(503).json({ code: 503, data: { status: 'degraded', db: 'down', reason: err.message } })
  }
})

app.use('/api', routes)

// 上传文件静态托管（图片 URL：/uploads/xxx.png）
app.use('/uploads', express.static(config.uploadDir))

// 托管 Vue 构建产物（Windows 便携版/Docker nginx 可选两种形态）
if (existsSync(config.publicDir)) {
  app.use(express.static(config.publicDir))
  app.use((_req, res, next) => {
    if (_req.method === 'GET' && !_req.path.startsWith('/api')) {
      res.sendFile(path.join(config.publicDir, 'index.html'))
    } else next()
  })
}

app.use(notFound)
app.use(errorHandler)

export default app
