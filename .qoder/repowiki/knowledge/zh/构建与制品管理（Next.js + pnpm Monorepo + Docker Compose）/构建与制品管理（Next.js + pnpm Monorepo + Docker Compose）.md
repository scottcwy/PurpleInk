---
kind: build_system
name: 构建与制品管理（Next.js + pnpm Monorepo + Docker Compose）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - next.config.ts
    - Dockerfile
    - server/Dockerfile
    - deploy/reverse-proxy/Dockerfile
    - docker-compose.dev.yml
    - docker-compose.prod.yml
    - scripts/dev/start-dev.ps1
    - vitest.config.ts
    - drizzle.config.ts
    - server/package.json
---

## 1. 使用的系统与工具
- **包管理器**: pnpm 10.30.0（通过 `packageManager` 字段锁定，`corepack enable` 激活），采用 workspace monorepo 结构。
- **前端框架**: Next.js 16（`next build` / `next start`），Turbopack 作为默认打包器。
- **后端运行**: server/ 子项目使用 tsx 直接执行 TypeScript 源码（无预编译产物），由 worker 进程常驻。
- **容器化**: 多阶段 Docker 构建（根 `Dockerfile` 产出 Next 应用镜像，`server/Dockerfile` 产出 worker 镜像，`deploy/reverse-proxy/Dockerfile` 产出 Caddy 反向代理镜像）。
- **编排**: docker-compose（`docker-compose.dev.yml` 开发环境仅含 Postgres；`docker-compose.prod.yml` 生产包含 reverse-proxy、next、worker、postgres、migrate、bootstrap-credentials、seed-demo-account 等）。数据库迁移使用 Drizzle Kit。
- **测试**: Vitest（`vitest.config.ts` 与 `vitest.pg.config.ts` 分离 PostgreSQL 集成测试）。
- **代码质量**: ESLint 9 + Prettier 3（`.prettierrc`、`eslint.config.mjs`）。

## 2. 关键文件与位置
- 根构建入口: `package.json`（scripts 定义 dev/build/start/lint/format/test/db:migrate 等）、`pnpm-workspace.yaml`、`next.config.ts`。
- 容器镜像: `Dockerfile`（Next 应用）、`server/Dockerfile`（worker）、`deploy/reverse-proxy/Dockerfile`（Caddy）。
- 编排配置: `docker-compose.dev.yml`、`docker-compose.prod.yml`。
- 数据库: `drizzle.config.ts`、`scripts/setup/db-migrate.ts`、`scripts/setup/postgres-init.sql`。
- 本地开发启动: `scripts/dev/start-dev.ps1`（PowerShell 一键拉起 Postgres → install → migrate → worker → next → readiness probe）。
- 测试配置: `vitest.config.ts`、`vitest.pg.config.ts`。
- 补丁: `patches/@earendil-works__pi-ai.patch`（pnpm patchedDependencies）。

## 3. 架构与约定
### 3.1 Monorepo 依赖解析
- 根 `pnpm-workspace.yaml` 声明 `.` 和 `server` 两个 package，共享同一份 `pnpm-lock.yaml`。所有 Docker 构建均以仓库根为上下文，确保依赖版本一致。
- `onlyBuiltDependencies` 白名单限制原生模块安装范围（esbuild、ffmpeg-static、sharp），减少构建体积。

### 3.2 多阶段 Docker 构建策略
- **deps 阶段**: 在 Linux 镜像内执行 `pnpm install --frozen-lockfile`，设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 跳过浏览器下载。
- **build 阶段**: `NODE_ENV=production` 下执行 `pnpm build`，触发 Next 的 `removeConsole` 优化（保留 error/warn）。
- **migrate 阶段**: 保留 devDependencies（tsx/drizzle-kit），供一次性迁移任务使用。
- **runtime 阶段**: 安装 fonts-wqy-zenhei（CJK 字体）、Chromium（按 node_modules 中 playwright 版本动态安装），以非 root 用户 `pwuser` 运行，Playwright 二进制路径设为 `/ms-playwright`。
- Next 镜像 CMD 直接调用 `node node_modules/next/dist/bin/next start`，避免 pnpm shim 问题。
- Worker 镜像通过 tsx 直接运行 `server/src/index.ts`，无需预编译。

### 3.3 服务编排与依赖顺序
- 生产编排严格遵循依赖顺序：postgres 健康检查 → migrate 完成 → bootstrap-credentials → seed-demo-account → next → worker。
- Next 通过 `next.config.ts` 的 `rewrites` 将 `/api/engine/*` 反向代理到 `BACKEND_ORIGIN`（默认 `http://localhost:8787`），实现同源部署、worker 不对外暴露。
- reverse-proxy（Caddy）是唯一对外端口（443），支持 TLS、IP 过滤、Basic Auth。

### 3.4 本地开发工作流
- `pnpm dev:all` 调用 `scripts/dev/start-dev.ps1`，自动完成：工具链校验（Node ≥22.11、pnpm 10.30.0）→ 环境变量检查 → Docker 引擎检测 → Postgres 启动与健康等待 → 依赖安装（lockfile 比对）→ 数据库迁移 → 分别启动 worker（8787）和 Next（3000）→ HTTP readiness probe。
- 端口冲突自动处理（-KillPort/-StrictPort 模式），支持 -SkipDocker/-SkipInstall/-SkipMigrate 等开关。
- 每个进程在独立 PowerShell 窗口运行，日志可 Tee 到 `.data/logs`。

### 3.5 构建产物与输出
- Next 构建产物位于 `.next`（可通过 `CVC_NEXT_DIST_DIR` 自定义目录，避免与 dev server 争用）。
- Worker 输出目录 `/repo/server/out` 和 `/repo/server/capture` 通过 volume 持久化。
- 数据库迁移 SQL 生成到 `src/lib/db/migrations/pg`。

## 4. 约定与约束
- **Node 版本**: 通过 `engines.node >= 22.11.0` 强制最低版本，开发脚本也硬编码校验。
- **pnpm 版本**: `packageManager: pnpm@10.30.0` 锁定，开发脚本验证一致性。
- **环境变量安全**: 开发脚本明确禁止打印/记录任何 secret 值；生产 compose 要求强口令不得沿用 dev 的 `cvc_dev_only`。
- **Playwright 浏览器**: 运行时按需安装，构建期跳过下载，避免跨平台二进制问题。
- **构建缓存优化**: deps 阶段只 COPY workspace manifest 和 lockfile，利用 Docker 层缓存；runtime 阶段最后 COPY src/ 以减少浏览器安装层的失效频率。
- **单实例部署**: Next 副本数固定为 1（因 stream-bus/status-bus 基于进程内 globalThis），不支持水平扩展。
- **停止命令**: 通过 `pnpm dev:stop` 清理端口占用进程，支持 `-Force` 跳过确认。
- **测试隔离**: 普通测试排除 `*.pg.test.ts`，PostgreSQL 测试通过独立配置文件运行。
- **外部包外部化**: `serverExternalPackages` 将 ffmpeg-static、@earendil-works/pi-ai、@earendil-works/pi-agent-core 保持 Node 原生解析，避免 Turbopack 动态 require 失败。

## 5. 关键流程总结
```
开发者执行 pnpm dev:all
  ↓
start-dev.ps1 校验工具链与环境变量
  ↓
docker-compose.dev.yml 启动 Postgres（健康检查）
  ↓
pnpm install（lockfile 比对决定是否重装）
  ↓
pnpm db:migrate（Drizzle Kit 迁移）
  ↓
启动 worker（tsx watch）+ Next dev server（独立窗口）
  ↓
HTTP readiness probe 验证 /health 与 /api/engine/health
  ↓
开发就绪，浏览器自动打开 products 页面
```

生产部署:
```
docker-compose.prod.yml up
  ↓
postgres (健康) → migrate (completed_successfully)
  ↓
bootstrap-credentials (凭据注入 DB) → seed-demo-account (可选)
  ↓
next (replicas=1, healthcheck) → worker (healthcheck)
  ↓
reverse-proxy (Caddy, 443/TLS/BASIC AUTH)
```