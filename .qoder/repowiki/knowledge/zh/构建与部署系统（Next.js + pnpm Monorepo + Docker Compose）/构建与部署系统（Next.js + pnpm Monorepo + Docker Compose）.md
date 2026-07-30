---
kind: build_system
name: 构建与部署系统（Next.js + pnpm Monorepo + Docker Compose）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - Dockerfile
    - server/Dockerfile
    - deploy/reverse-proxy/Dockerfile
    - docker-compose.dev.yml
    - docker-compose.prod.yml
    - pnpm-workspace.yaml
    - scripts/dev/start-dev.ps1
    - drizzle.config.ts
    - vitest.config.ts
    - server/package.json
---

## 1. 构建系统与工具链
- 包管理器：pnpm 10.30.0（通过 `packageManager` 字段锁定，`corepack enable pnpm@10.30.0 --activate` 在 Docker 中启用），工作区包含根 Next.js 应用与 `server/` worker 两个包。
- Node 版本要求：`engines.node >= 22.11.0`，开发启动脚本强制校验该版本。
- 前端构建：Next.js 16（`next build` / `next start`），生产镜像未启用 `output: 'standalone'`，而是将完整 `node_modules` 打入运行镜像以保留迁移能力。
- 后端 worker：基于 tsx 直接执行 TypeScript 源码（`tsx src/index.ts`），无预编译产物。
- 数据库迁移：Drizzle Kit（`drizzle.config.ts` 指向 `src/lib/db/schema/index.ts`，输出至 `src/lib/db/migrations/pg`），通过 `pnpm db:migrate` 执行。
- 测试：Vitest（`vitest.config.ts` 与 `vitest.pg.config.ts` 分离，`.pg.test.ts` 文件走 PostgreSQL 套件）。
- 代码质量：ESLint 9 + Prettier 3（含 Tailwind CSS 插件），`eslint.config.mjs`、`.prettierrc`。

## 2. 多阶段 Docker 构建
- 根应用镜像（`Dockerfile`）：
  - `deps` 阶段：Linux 内 `pnpm install --frozen-lockfile`，设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 跳过浏览器下载。
  - `build` 阶段：`NODE_ENV=production` 下 `pnpm build`，触发 next.config.ts 的 console 移除逻辑。
  - `migrate` 阶段：保留 devDependencies（tsx/drizzle-kit），ENTRYPOINT 为 `pnpm db:migrate`，供一次性迁移任务使用。
  - `runtime` 阶段：安装 CJK 字体（fonts-wqy-zenhei）、Chromium 依赖、创建非 root 用户 `pwuser`，Playwright 浏览器二进制放在 `/ms-playwright`，CMD 直接调用 `node node_modules/next/dist/bin/next start`。
- Worker 镜像（`server/Dockerfile`）：
  - 独立构建上下文，复用 workspace 级 `pnpm install` 结果。
  - 运行时通过 tsx 直接执行 `server/src/index.ts`，暴露端口 8787。
  - 同样安装 fonts-wqy-zenhei 与 Chromium，按 pwuser 非 root 运行。
- 反向代理（`deploy/reverse-proxy/Dockerfile`）：基于 `caddy:2.10-alpine`，挂载 Caddyfile 与 entrypoint 脚本。

## 3. 编排与部署
- 开发编排（`docker-compose.dev.yml`）：仅启动 Postgres 17.5-alpine，映射 127.0.0.1:54328:5432，带健康检查与初始化 SQL。
- 生产编排（`docker-compose.prod.yml`）：
  - `reverse-proxy`：唯一对外端口 443，Caddy 处理 TLS + IP 白名单 + Basic Auth，secrets 从文件注入。
  - `next`：固定 replicas=1（进程内 stream-bus/status-bus 限制），healthcheck 调用 `/api/ping`。
  - `worker`：不对外暴露，通过 `BACKEND_ORIGIN` 被 next 内网访问。
  - `postgres`：独立持久卷，强口令强制。
  - `migrate`、`bootstrap-credentials`、`seed-demo-account`：一次性任务，依赖 migrate 完成。
- 环境变量管理：生产 compose 通过 `${VAR:?错误消息}` 强制必填项，避免配置漂移。

## 4. 本地开发流程
- 一键启动脚本（`scripts/dev/start-dev.ps1`）：
  - 工具链预检：Node ≥ 22.11.0、pnpm 10.30.0、Docker 引擎状态。
  - 环境预检：读取 `.env` / `.env.local`，校验必需变量名（值永不打印或记录）。
  - 依赖管理：比较 `pnpm-lock.yaml` 与 `.modules.yaml` 时间戳决定是否重新安装。
  - 数据库：自动拉起 docker compose postgres，等待健康检查与 TCP 握手。
  - 迁移：`pnpm db:migrate`。
  - 进程启动：Worker 先于 Next 启动，各自独立 PowerShell 窗口，端口冲突自动探测并可选 kill 或偏移。
  - 就绪探针：轮询 worker `/health`、web `/`、同域 engine proxy `/api/engine/health`。
- npm scripts：`dev`（Next）、`dev:worker`（worker）、`dev:all`（PowerShell 启动器）、`test`、`test:pg`、`db:generate`、`db:migrate`、`typecheck`、`lint`、`format`。

## 5. 关键约定与约束
- 禁止 Windows 宿主 `node_modules` 复制到 Linux 容器（注释明确说明 ffmpeg-static postinstall 必须在 Linux 内执行）。
- Playwright 浏览器二进制通过动态读取 `node_modules/playwright/package.json` 的版本号安装，确保与依赖一致。
- 生产镜像 CMD 直接调用 `node node_modules/next/dist/bin/next start`，不走 pnpm 生成的 POSIX shell shim（避免语法解析错误）。
- Worker 镜像必须复制根 `src/` 目录，因为 `run-pipeline.ts` 通过相对路径引用根 `src/lib/tts/config`。
- Next 应用在生产模式禁用控制台输出（`next.config.ts` 的 `removeConsole exclude: ['error','warn']`）。
- 凭据注入策略：AI 提供商 Key 通过 `bootstrap-credentials` 一次性任务写入加密 DB，运行时只读 DB，终端用户无需手动配置。
- 并发控制：`CVC_QUEUE_RENDER_SHOT_CONCURRENCY` 与 `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY` 必须显式设置，否则按宿主核数并发导致 OOM。
- 补丁机制：`patches/@earendil-works__pi-ai.patch` 通过 pnpm `patchedDependencies` 应用。