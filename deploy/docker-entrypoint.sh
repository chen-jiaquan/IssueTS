# 等待 PG 就绪 → 迁移 → 首次种子 → 启动 Node
#!/bin/sh
set -e

echo "[entrypoint] 等待 PostgreSQL 就绪..."
node deploy/wait-for-db.js

echo "[entrypoint] 执行数据库迁移..."
node server/src/db/migrate.js

if [ "${SEED_ON_BOOT:-true}" = "true" ]; then
  echo "[entrypoint] 执行种子数据（幂等）..."
  node server/src/db/seed.js
fi

echo "[entrypoint] 启动应用..."
exec node server/src/server.js
