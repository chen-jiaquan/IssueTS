import { pool } from '../db/pool.js'

// 系统设置存储在 app_meta(key,value)；缺失或脏值回退到默认值。
export const ISSUE_EXPORT_LIMIT_KEY = 'issue_export_limit'
export const DEFAULT_ISSUE_EXPORT_LIMIT = 0 // 0=不限制

export async function getIssueExportLimit() {
  const { rows } = await pool.query('SELECT value FROM app_meta WHERE key = $1', [ISSUE_EXPORT_LIMIT_KEY])
  const value = Number(rows[0]?.value ?? DEFAULT_ISSUE_EXPORT_LIMIT)
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_ISSUE_EXPORT_LIMIT
}

export async function setIssueExportLimit(value) {
  await pool.query(
    `INSERT INTO app_meta(key, value) VALUES($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
    [ISSUE_EXPORT_LIMIT_KEY, String(value)],
  )
  return value
}
