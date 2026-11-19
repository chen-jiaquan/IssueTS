import dotenv from 'dotenv'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 优先级：环境变量 > 根目录 .env > config/app.env
const candidates = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(process.cwd(), 'config/app.env'),
  path.resolve(process.cwd(), '.env'),
]
const envFile = candidates.find((p) => existsSync(p))
if (envFile) dotenv.config({ path: envFile })

const num = (v, d) => (v !== undefined && v !== '' ? Number(v) : d)
const bool = (v, d = false) => (v === undefined ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()))

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.APP_PORT, 3000),
  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: num(process.env.POSTGRES_PORT, 5432),
    user: process.env.POSTGRES_USER || 'issue',
    password: process.env.POSTGRES_PASSWORD || '',
    database: process.env.POSTGRES_DB || 'issue_tracker',
    poolMax: num(process.env.PG_POOL_MAX, 20),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  redis: {
    enabled: bool(process.env.REDIS_ENABLED, false),
    host: process.env.REDIS_HOST || 'localhost',
    port: num(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || '',
  },
  uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, '../../../uploads'),
  publicDir: path.resolve(__dirname, '../../../public'),
}
