---
kind: build_system
name: 构建与制品管理（Next.js + 独立 Worker 的多阶段 Docker 流水线）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - Dockerfile
    - server/Dockerfile
    - docker-compose.dev.yml
    - docker-compose.prod.yml
    - next.config.ts
    - scripts/dev/start-dev.ps1
    - deploy/reverse-proxy/Dockerfile
---

## 1. 使用的系统与工具
- **包管理器**：pnpm 10.30.0（通过 `packageManager` 字段锁定，Corepack 启用），采用 pnpm workspace 管理根 Next 应用与 `server/` 渲染 Worker 两个子包。
- **前端构建**：Next.js 16（`next build` / `next start`），Turbopack 作为默认构建器，生产环境关闭 source maps。
- **后端运行**：Worker 使用 tsx 直接执行 TypeScript 源码（`tsx src/index.ts`），不预编译产物。
- **容器化**：多阶段 Dockerfile（deps → build/migrate → runtime），PostgreSQL 17 通过 docker-compose 编排。
- **测试**：Vitest 4（含 PostgreSQL 专用配置 `vitest.pg.config.ts`），Playwright 用于 E2E。
- **代码质量**：ESLint 9、Prettier 3、TypeScript 5（`tsc --noEmit` 类型检查）。

## 2. 关键文件与位置
- `package.json`：根脚本入口（`dev`/`build`/`start`/`test`/`db:migrate`/`verify:*`）、依赖声明、pnpm onlyBuiltDependencies 与 patchedDependencies。
- `pnpm-workspace.yaml`：定义 workspace 包含 `.` 与 `server`。
- `Dockerfile`（根）：Next 应用镜像，三阶段构建（deps/build/migrate/runtime），非 root pwuser 运行，Chromium 按 playwright 版本安装。
- `server/Dockerfile`：Worker 镜像，复用 workspace node_modules，tsx 直跑源码，同样安装 CJK 字体与 Chromium。
- `docker-compose.dev.yml` / `docker-compose.prod.yml`：开发仅启动 Postgres；生产编排 reverse-proxy(Caddy) → next → worker → postgres，含 migrate/bootstrap/seed 一次性任务。
- `next.config.ts`：反向代理 `/api/engine/*` → `BACKEND_ORIGIN`、serverExternalPackages 排除动态 require 的 pi-ai 包、生产移除 console 但保留 error/warn。
- `scripts/dev/start-dev.ps1`：Windows 一键开发启动器，自动校验 Node/pnpm 版本、启动 Docker Postgres、执行迁移、分别拉起 Next 与 Worker 进程并做健康探测。
- `deploy/reverse-proxy/Dockerfile` + `Caddyfile`：Caddy 反向代理，TLS + Basic Auth + IP 白名单。

## 3. 架构与约定
- **双服务分离**：Next 前端（:3000）仅暴露给 Caddy 反向代理，渲染 Worker（:8787）通过内网 `BACKEND_ORIGIN` 被 Next 访问，浏览器无跨域问题。
- **多阶段镜像分层**：
  - `deps` 阶段在 Linux 中执行 `pnpm install --frozen-lockfile`，避免 Windows 宿主二进制污染；跳过 Playwright 浏览器下载，运行时按需安装。
  - `build` 阶段执行 `next build`，`NODE_ENV=production` 触发 removeConsole 分支。
  - `migrate` 阶段保留 devDependencies（tsx/drizzle-kit）供一次性迁移任务。
  - `runtime` 阶段仅拷贝必要文件，以非 root `pwuser` 运行，Chromium 安装到 `/ms-playwright` 共享目录。
- **字体策略**：选用 7.5MB 的 `fonts-wqy-zenhei` 替代 60MB 的 `fonts-noto-cjk`，解决构建网络大文件中断问题，满足中文渲染需求。
- **依赖隔离**：`onlyBuiltDependencies` 仅允许 esbuild/ffmpeg-static/sharp 原生构建；`patchedDependencies` 对 `@earendil-works/pi-ai` 打补丁。
- **环境变量治理**：`.env` → `.env.local` 覆盖（Next 语义），生产通过 docker-compose 注入强口令与 API Key，migrate target 镜像负责凭据引导。

## 4. 约定与约束
- **Node 版本**：`engines.node >= 22.11.0`，开发脚本强制校验最低版本。
- **pnpm 版本锁定**：`packageManager: pnpm@10.30.0`，开发脚本比对实际版本并告警。
- **禁止多实例 Next**：生产 compose 固定 `replicas: 1`，因 stream-bus/status-bus 基于进程内 globalThis 锚定。
- **端口冲突处理**：开发脚本支持 `-KillPort`/`-StrictPort`/自动偏移，确保 3000/8787 可用。
- **健康检查**：Next 通过 `/api/ping`、Worker 通过 `/health`、engine 反向代理通过 `/api/engine/health` 三级探测。
- **数据库迁移**：`pnpm db:migrate` 由开发脚本自动执行，生产 compose 中 migrate 服务必须 `completed_successfully` 后 next 才启动。
- **安全运行**：容器内以 `pwuser` 非 root 用户运行，Chromium 沙箱开启（加载模型生成 HTML 需防线）。
- **构建可重复性**：所有阶段使用 `--frozen-lockfile`，依赖版本由 pnpm-lock.yaml 锁定。