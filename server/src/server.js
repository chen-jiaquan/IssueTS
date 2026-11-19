import app from './app.js'
import { config } from './config/index.js'
import { pool } from './db/pool.js'

const server = app.listen(config.port, () => {
  console.log(`[server] 已启动: http://localhost:${config.port} (env=${config.env})`)
  console.log(`[server] DB: ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`)
})

async function shutdown(signal) {
  console.log(`[server] 收到 ${signal}，正在关闭...`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
  try { await pool.end() } catch { /* 已关闭 */ }
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
