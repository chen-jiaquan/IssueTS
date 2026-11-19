# 多阶段构建：builder（前端构建+依赖安装）→ runtime（仅 node:24-alpine + 运行产物）
# 基础镜像走 DaoCloud 源（本机 Docker Hub 直连不通）
FROM docker.m.daocloud.io/library/node:24-alpine AS builder

WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY web/ ./
RUN npm run build

WORKDIR /build/server
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM docker.m.daocloud.io/library/node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /build/server/node_modules ./server/node_modules
COPY server/ ./server/
COPY --from=builder /build/web/dist ./public
COPY deploy/ ./deploy/

RUN mkdir -p /app/uploads && chmod +x deploy/*.sh

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.APP_PORT||3000)+'/health').then(r=>r.status===200?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

ENTRYPOINT ["deploy/docker-entrypoint.sh"]
