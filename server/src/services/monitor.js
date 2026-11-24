import os from 'node:os'
import { pool } from '../db/pool.js'
import { config } from '../config/index.js'
import { getOnlineSessions } from './sessions.js'

const round = (value, digits = 1) => {
  const factor = 10 ** digits
  return Math.round(Number(value || 0) * factor) / factor
}
const toMb = (bytes) => round(Number(bytes || 0) / 1024 / 1024, 1)
const toSeconds = (ms) => round(Number(ms || 0) / 1000, 0)

export async function getMonitorStatus() {
  const [dbResult, userResult, onlineResult] = await Promise.all([
    pool.query(`
      SELECT current_database() AS name,
             current_setting('server_version') AS version,
             pg_size_pretty(pg_database_size(current_database())) AS size_pretty,
             pg_database_size(current_database())::bigint AS size_bytes,
             COALESCE((SELECT numbackends FROM pg_stat_database WHERE datname = current_database()), 0)::int AS connections,
             current_setting('max_connections')::int AS max_connections
    `),
    pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = '启用')::int AS enabled,
             count(*) FILTER (WHERE status = '停用')::int AS disabled,
             count(*) FILTER (WHERE preset)::int AS preset,
             count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS recent_30d
      FROM users
    `),
    getOnlineSessions(),
  ])

  const mem = process.memoryUsage()
  const cpu = process.cpuUsage()
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const load = os.loadavg()

  return {
    generated_at: new Date().toISOString(),
    database: {
      ...dbResult.rows[0],
      size_bytes: Number(dbResult.rows[0].size_bytes),
      pool: {
        max: config.db.poolMax,
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        pending: pool.pendingCount || 0,
      },
    },
    server: {
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      hostname: os.hostname(),
      uptime_seconds: Math.floor(process.uptime()),
      os_uptime_seconds: Math.floor(os.uptime()),
      cpu_count: cpus.length,
      cpu_model: cpus[0]?.model || '',
      cpu_load_1m: round(load[0], 2),
      cpu_load_5m: round(load[1], 2),
      cpu_load_15m: round(load[2], 2),
      cpu_process_user_seconds: toSeconds(cpu.user),
      cpu_process_system_seconds: toSeconds(cpu.system),
      memory_total_mb: toMb(totalMem),
      memory_free_mb: toMb(freeMem),
      memory_used_percent: round(((totalMem - freeMem) / totalMem) * 100, 1),
      process_rss_mb: toMb(mem.rss),
      process_heap_used_mb: toMb(mem.heapUsed),
      process_heap_total_mb: toMb(mem.heapTotal),
    },
    users: {
      ...userResult.rows[0],
      online: onlineResult,
    },
  }
}
