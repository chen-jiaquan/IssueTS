# 问题跟踪系统（IssueTS）

Vue 3 + Express + PostgreSQL 的问题跟踪系统。设计依据见 `docs/`（五份规格文档为唯一事实来源）。

> 当前状态：**骨架阶段** — 前后端可启动、迁移机制就绪；业务模块（问题/统计/档案/权限等）按文档分段开发。

## 技术栈

- 前端：Vue 3 + Vite + Element Plus + Pinia + Vue Router
- 后端：Node.js 24 + Express + express-validator（JWT 鉴权）
- 数据库：PostgreSQL 14（迁移版本化）+ Redis 7（可选缓存）
- 部署：Docker（主）/ Windows 便携版与服务化（次，脚本待开发）

## 本地开发

前置：Node ≥ 24、Docker（PG/Redis 走容器）。

```powershell
# 1. 启动数据库（PostgreSQL + Redis）
docker compose -f docker-compose.dev.yml up -d

# 2. 配置环境（首次）
copy .env.example .env    # 按需修改

# 3. 安装依赖
npm run install:all

# 4. 数据库迁移（当前仅机制验证占位表）
npm run migrate

# 5. 启动（两个终端）
npm run dev:server   # 后端 http://localhost:3000
npm run dev:web      # 前端 http://localhost:5173（/api 代理到 3000）
```

验证：浏览器打开 `http://localhost:5173`，首页卡片显示 `/health` 返回 `db: up` 即骨架就绪。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev:server` / `dev:web` | 分别启动后端/前端开发服务 |
| `npm run migrate` / `seed` | 执行数据库迁移 / 种子 |
| `npm run build` | 前端构建 → `public/`（后端同进程托管） |
| `docker compose up -d --build` | 生产形态（redis: `--profile cache`，nginx: `--profile proxy`） |

## 目录

```
server/   Express 后端（routes→controllers→services→db 分层，migrations 版本化）
web/      Vue3 前端（views/components/composables/store/api，主题三套）
deploy/   Docker 入口脚本与 DB 等待探针
nginx/    反代与静态托管配置（可选 profile）
scripts/  构建/打包脚本
docs/     规格文档（需求/架构/数据模型/API 契约/页面原型）
config/   app.env.example 部署配置模板
```

## 环境配置

敏感信息走 `.env`（不入库），模板见 `.env.example`；部署态模板 `config/app.env.example`。
