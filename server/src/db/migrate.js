// 执行 server/migrations/*.sql（按文件名升序），记录到 schema_migrations
// 用法: npm --prefix server run migrate
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './pool.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.resolve(__dirname, '../../migrations')

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
}

export async function migrate() {
  const client = await pool.connect()
  try {
    await ensureTable(client)
    const { rows } = await client.query('SELECT name FROM schema_migrations')
    const applied = new Set(rows.map((r) => r.name))

    let files
    try {
      files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
    } catch {
      console.log('[migrate] migrations 目录不存在，跳过')
      return
    }

    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(path.join(migrationsDir, file), 'utf8')
      console.log(`[migrate] 应用 ${file} ...`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`[migrate] ${file} 完成`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`${file} 执行失败: ${err.message}`)
      }
    }
    console.log('[migrate] 全部迁移已完成')
  } finally {
    client.release()
    await pool.end()
  }
}

// 直接运行时执行
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate().catch((err) => {
    console.error('[migrate] 失败:', err.message)
    process.exit(1)
  })
}
