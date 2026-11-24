import crypto from 'node:crypto'
import { pool } from '../db/pool.js'
import { config } from '../config/index.js'
import { HttpError, ERR } from '../utils/resp.js'

const IDLE_KEY = 'session_idle_timeout_minutes'
const DEFAULT_IDLE_MINUTES = 30
let idleCache = { value: null, at: 0 }

export async function getIdleTimeoutMinutes() {
  if (idleCache.value !== null && Date.now() - idleCache.at < 30000) return idleCache.value
  let minutes = DEFAULT_IDLE_MINUTES
  try {
    const { rows } = await pool.query(
      `SELECT value FROM system_settings WHERE setting_key=$1 AND projects='{}'::text[]`, [IDLE_KEY],
    )
    const parsed = Number(rows[0]?.value)
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 10080) minutes = parsed
  } catch { /* 表未就绪时使用默认值 */ }
  idleCache = { value: minutes, at: Date.now() }
  return minutes
}

export async function setIdleTimeoutMinutes(value) {
  const minutes = Number(value)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    throw new HttpError(400, ERR.VALIDATION, '自动下线时间须为 1~10080 分钟', [{ field: 'minutes' }])
  }
  await pool.query(
    `INSERT INTO system_settings(setting_key, projects, value) VALUES ($1,'{}'::text[],$2)
     ON CONFLICT (setting_key, projects) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [IDLE_KEY, String(minutes)],
  )
  idleCache = { value: minutes, at: Date.now() }
  return minutes
}

const ttlSeconds = (ttl) => {
  const match = /^(\d+)([smhd])$/.exec(String(ttl || '7d'))
  if (!match) return 7 * 86400
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]] || 86400
  return Number(match[1]) * unit
}

export function createTokenIds() {
  return { accessJti: crypto.randomUUID(), refreshJti: crypto.randomUUID() }
}

export async function createSession({ userId, username, loginProject, accessJti, refreshJti }) {
  const expiresAt = new Date(Date.now() + ttlSeconds(config.jwt.refreshTtl) * 1000)
  const { rows } = await pool.query(
    `INSERT INTO user_sessions(user_id, username, access_jti, refresh_jti, login_project, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, login_at`,
    [userId, username, accessJti, refreshJti, loginProject || null, expiresAt],
  )
  return { id: rows[0].id, expiresAt }
}

export async function activateSession(id, accessJti) {
  await pool.query(
    'UPDATE user_sessions SET access_jti=$2, last_seen_at=now() WHERE id=$1',
    [id, accessJti],
  )
}

export async function endSession(sid, reason = 'logout') {
  if (!sid) return
  await pool.query(
    `UPDATE user_sessions SET ended_at=now(), end_reason=$2
     WHERE id=$1 AND ended_at IS NULL`,
    [sid, reason],
  )
}

export async function endSessionByRefreshJti(refreshJti, reason = 'kicked') {
  if (!refreshJti) return null
  const { rows } = await pool.query(
    `UPDATE user_sessions SET ended_at=now(), end_reason=$2
     WHERE refresh_jti=$1 AND ended_at IS NULL RETURNING id, access_jti, refresh_jti`,
    [refreshJti, reason],
  )
  return rows[0] || null
}

export async function refreshSession(refreshJti, accessJti) {
  const { rows } = await pool.query(
    `UPDATE user_sessions SET access_jti=$2, last_seen_at=now()
     WHERE refresh_jti=$1 AND ended_at IS NULL AND expires_at > now()
     RETURNING id`,
    [refreshJti, accessJti],
  )
  return rows[0] || null
}

export async function listActiveSessions(userId) {
  const { rows } = await pool.query(
    `SELECT id, username, login_project, login_at, last_seen_at
     FROM user_sessions
     WHERE user_id=$1 AND ended_at IS NULL AND expires_at > now()
     ORDER BY login_at DESC`, [userId],
  )
  return rows
}

export async function expireIdleSessions(userId, minutes) {
  const params = [minutes]
  let userClause = ''
  if (userId) {
    userClause = ' AND user_id=$2'
    params.push(userId)
  }
  const { rowCount } = await pool.query(
    `UPDATE user_sessions SET ended_at=now(), end_reason='idle'
     WHERE ended_at IS NULL AND expires_at > now()
       AND last_seen_at < now() - make_interval(mins => $1::int)${userClause}`, params,
  )
  return rowCount
}

export async function endAllUserSessions(userId, reason = 'kicked') {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE user_sessions SET ended_at=now(), end_reason=$2
       WHERE user_id=$1 AND ended_at IS NULL
       RETURNING refresh_jti, expires_at`, [userId, reason],
    )
    for (const session of rows) {
      if (session.refresh_jti) {
        await client.query(
          `INSERT INTO refresh_revocations(jti, expires_at) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [session.refresh_jti, session.expires_at],
        )
      }
    }
    await client.query('COMMIT')
    return rows.length
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function kickSession(id) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE user_sessions SET ended_at=now(), end_reason='kicked'
       WHERE id=$1 AND ended_at IS NULL
       RETURNING refresh_jti, expires_at`, [id],
    )
    const session = rows[0]
    if (!session) {
      await client.query('ROLLBACK')
      return false
    }
    if (session.refresh_jti) {
      await client.query(
        `INSERT INTO refresh_revocations(jti, expires_at) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [session.refresh_jti, session.expires_at],
      )
    }
    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getOnlineSessions() {
  const [sessions, byProject] = await Promise.all([
    pool.query(
      `SELECT s.id, s.user_id, s.username, u.person, r.name AS role,
              COALESCE(s.login_project, 'ALL') AS project_code,
              COALESCE(p.name, '全部项目') AS project_name,
              s.login_at, s.last_seen_at,
              EXTRACT(EPOCH FROM (now() - s.login_at))::int AS online_seconds
       FROM user_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN roles r ON r.code = u.role_code
       LEFT JOIN projects p ON p.code = s.login_project
       WHERE s.ended_at IS NULL AND s.expires_at > now()
       ORDER BY s.login_at DESC`,
    ),
    pool.query(
      `SELECT COALESCE(s.login_project, 'ALL') AS project_code,
              COALESCE(p.name, '全部项目') AS project_name,
              count(*)::int AS count
       FROM user_sessions s
       LEFT JOIN projects p ON p.code = s.login_project
       WHERE s.ended_at IS NULL AND s.expires_at > now()
       GROUP BY COALESCE(s.login_project, 'ALL'), COALESCE(p.name, '全部项目')
       ORDER BY count DESC, project_code`,
    ),
  ])
  return { total: sessions.rows.length, by_project: byProject.rows, sessions: sessions.rows }
}
