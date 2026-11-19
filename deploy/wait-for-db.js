// 轮询等待 PostgreSQL TCP 可达（镜像内无 psql，用 Node 探测）
import net from 'node:net'

const host = process.env.POSTGRES_HOST || 'postgres'
const port = Number(process.env.POSTGRES_PORT || 5432)
const maxAttempts = Number(process.env.DB_WAIT_ATTEMPTS || 60)

function tryConnect() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 2000 })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}

for (let i = 1; i <= maxAttempts; i++) {
  if (await tryConnect()) {
    console.log(`[wait-for-db] PostgreSQL ${host}:${port} 就绪（第 ${i} 次探测）`)
    process.exit(0)
  }
  console.log(`[wait-for-db] 等待 ${host}:${port} ... (${i}/${maxAttempts})`)
  await new Promise((r) => setTimeout(r, 2000))
}
console.error(`[wait-for-db] 超时：PostgreSQL ${host}:${port} 不可达`)
process.exit(1)
