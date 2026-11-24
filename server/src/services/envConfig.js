import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config, envFilePath } from '../config/index.js'
import { HttpError, ERR } from '../utils/resp.js'

const validPort = (value, field) => {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(400, ERR.VALIDATION, '端口须为 1~65535 的整数', [{ field }])
  }
  return port
}

const validText = (value, field, fallback) => {
  const text = value === undefined || value === null || value === '' ? fallback : String(value).trim()
  if (!/^[A-Za-z0-9_.-]+$/.test(text)) {
    throw new HttpError(400, ERR.VALIDATION, `${field} 仅允许字母、数字及 . _ -`, [{ field }])
  }
  return text
}

const validPoolMax = (value) => {
  const max = Number(value)
  if (!Number.isInteger(max) || max < 1 || max > 200) {
    throw new HttpError(400, ERR.VALIDATION, '连接池上限须为 1~200 的整数', [{ field: 'poolMax' }])
  }
  return max
}

const setEnvValue = (content, key, value) => {
  const pattern = new RegExp(`^${key}\\s*=.*$`, 'm')
  const line = `${key}=${value}`
  if (pattern.test(content)) return content.replace(pattern, line)
  return `${content.trimEnd()}\n${line}\n`
}

export async function getPortConfig() {
  return {
    server: {
      appPort: config.port,
      listenAddress: '0.0.0.0',
      env: config.env,
    },
    database: {
      host: config.db.host,
      port: config.db.port,
      name: config.db.database,
      user: config.db.user,
      poolMax: config.db.poolMax,
      passwordConfigured: !!config.db.password,
    },
    redis: {
      enabled: config.redis.enabled,
      host: config.redis.host,
      port: config.redis.port,
      passwordConfigured: !!config.redis.password,
    },
    envFile: path.basename(envFilePath),
    restartRequired: true,
  }
}

export async function updatePortConfig(body = {}) {
  const appPort = validPort(body.appPort ?? body.server?.appPort ?? body.app_port, 'appPort')
  const dbHost = validText(body.dbHost ?? body.database?.host ?? body.postgresHost, 'dbHost', config.db.host)
  const dbPort = validPort(body.dbPort ?? body.database?.port ?? body.db_port, 'dbPort')
  const dbName = validText(body.dbName ?? body.database?.name, 'dbName', config.db.database)
  const dbUser = validText(body.dbUser ?? body.database?.user, 'dbUser', config.db.user)
  const poolMax = validPoolMax(body.poolMax ?? body.database?.poolMax ?? config.db.poolMax)
  const redisEnabled = body.redisEnabled ?? body.redis?.enabled ?? config.redis.enabled
  const redisHost = validText(body.redisHost ?? body.redis?.host, 'redisHost', config.redis.host)
  const redisPort = validPort(body.redisPort ?? body.redis?.port, 'redisPort')

  let content = ''
  try {
    content = await readFile(envFilePath, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const updates = {
    APP_PORT: appPort,
    POSTGRES_HOST: dbHost,
    POSTGRES_PORT: dbPort,
    POSTGRES_DB: dbName,
    POSTGRES_USER: dbUser,
    PG_POOL_MAX: poolMax,
    REDIS_ENABLED: redisEnabled ? '1' : '0',
    REDIS_HOST: redisHost,
    REDIS_PORT: redisPort,
  }
  for (const [key, value] of Object.entries(updates)) {
    content = setEnvValue(content, key, value)
  }
  await writeFile(envFilePath, content, 'utf8')

  return {
    server: {
      appPort,
      listenAddress: '0.0.0.0',
      env: config.env,
    },
    database: {
      host: dbHost,
      port: dbPort,
      name: dbName,
      user: dbUser,
      poolMax,
      passwordConfigured: !!config.db.password,
    },
    redis: {
      enabled: !!redisEnabled,
      host: redisHost,
      port: redisPort,
      passwordConfigured: !!config.redis.password,
    },
    envFile: path.basename(envFilePath),
    restartRequired: true,
  }
}
