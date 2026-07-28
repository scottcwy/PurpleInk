---
kind: build_system
name: 构建与部署系统（Next.js + 独立渲染 Worker + Docker）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - Dockerfile
    - server/Dockerfile
    - deploy/reverse-proxy/Dockerfile
    - docker-compose.prod.yml
    - docker-compose.dev.yml
    - next.config.ts
    - pnpm-workspace.yaml
    - scripts/dev/start-dev.ps1
    - server/package.json
    - deploy/reverse-proxy/Caddyfile
    - deploy/reverse-proxy/entrypoint.sh
---

## 1. 构建系统与工具链
- **包管理器**: pnpm 10.30.0（通过 `packageManager` 字段锁定），使用 pnpm workspace 管理根 Next 应用与 `server/` 独立渲染后端两个子项目。
- **运行时要求**: Node.js >= 22.11.0（`engines` 字段强制，开发启动脚本 `scripts/dev/start-dev.ps1` 会校验版本）。
- **前端构建**: Next.js 16 (`next build`)，生产构建启用 `removeConsole: { exclude: ['error','warn'] }` 移除 console.log 但保留诊断信息；禁用 source maps 保护源码。
- **后端运行**: server/ 不预编译，直接通过 `tsx` 执行 TypeScript 源码（`pnpm dev` / `pnpm start`）。
- **测试**: Vitest 4.x（`vitest run`），PostgreSQL 集成测试通过独立配置 `vitest.pg.config.ts` 运行。
- **代码质量**: ESLint 9 + Prettier 3（含 Tailwind 插件），提供 `lint`、`lint:fix`、`format`、`format:check` 脚本。
- **类型检查**: `tsc --noEmit`（`typecheck` / `typecheck:web` 脚本）。

## 2. 容器化与镜像分层
仓库包含三个独立的 Dockerfile，采用多阶段构建：
- **根 `Dockerfile`**（Next 应用）:
  - `deps` 阶段：`corepack enable` + `pnpm install --frozen-lockfile`，跳过浏览器下载（`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`）。
  - `build` 阶段：`pnpm build` 生成 `.next`。
  - `migrate` 阶段：保留 devDependencies 用于一次性迁移任务。
  - `runtime` 阶段：安装 CJK 字体（fonts-wqy-zenhei，7.5MB，替代失败的 60MB fonts-noto-cjk）、Chromium 浏览器二进制、以非 root 用户 `pwuser` 运行。
  - 入口：直接调用 `node node_modules/next/dist/bin/next start`（绕过 pnpm shim 的 shell 解析问题）。
- **`server/Dockerfile`**（渲染 worker）:
  - 同样基于 `node:22-bookworm-slim`，通过 tsx 直接运行 TS 源码。
  - 复制根 `src/` 目录供跨目录引用 TTS 配置（唯一一处跨目录依赖）。
  - 暴露端口 8787，入口为 `node_modules/.bin/tsx server/src/index.ts`。
- **`deploy/reverse-proxy/Dockerfile`**（Caddy 反向代理）:
  - 基于 `caddy:2.10-alpine`，从 compose secret 注入 Basic Auth 凭据。

## 3. 编排与部署
- **开发环境**: `docker-compose.dev.yml` 仅启动 PostgreSQL 17.5-alpine，端口映射到 `127.0.0.1:54328`，带健康检查与初始化 SQL。
- **生产环境**: `docker-compose.prod.yml` 编排 6 个服务：
  - `reverse-proxy`（Caddy，仅对外暴露 443，TLS + IP 过滤 + Basic Auth）
  - `next`（Next 应用，replicas=1，因进程内状态机不支持多实例）
  - `worker`（渲染后端，内网访问，BACKEND_ORIGIN=http://worker:8787）
  - `postgres`（持久卷，强口令）
  - `migrate`（一次性数据库迁移）
  - `bootstrap-credentials` / `seed-demo-account`（一次性凭据注入与演示账号）
- **反向代理**: Next 通过 `next.config.ts` 的 `rewrites` 将 `/api/engine/:path*` 转发到 `BACKEND_ORIGIN`（默认 `http://localhost:8787`），实现同源部署、无跨域。

## 4. 开发工作流
- **一键启动**: `pnpm dev:all` 调用 PowerShell 脚本 `scripts/dev/start-dev.ps1`，按依赖顺序自动：
  1. 工具链预检（Node/pnpm/Docker 版本）
  2. 环境变量校验（`.env` + `.env.local`，禁止打印敏感值）
  3. 启动 Postgres（Docker Desktop 自动拉起）
  4. 依赖安装（比较 lockfile 时间戳避免重复安装）
  5. 数据库迁移
  6. 分别打开独立 PowerShell 窗口运行 Next 和 worker
  7. HTTP 就绪探测（web、worker、engine 反向代理）
- **端口管理**: 自动检测端口冲突，支持 `-KillPort` 杀死占用进程或自动切换到空闲端口，并动态调整 `BACKEND_ORIGIN`。
- **辅助命令**: `dev:status` 查看栈状态，`dev:stop` 停止进程。

## 5. 关键约束与设计决策
- **单实例限制**: Next 应用 replicas 固定为 1，因为 stream-bus/status-bus 使用进程内 `globalThis` 锚定，多实例不安全。
- **CPU 并发显式设置**: 容器内 CPU 核数读取宿主而非 cgroup 限额，必须通过 `CVC_QUEUE_RENDER_SHOT_CONCURRENCY` / `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY` 环境变量显式设置，否则 OOMKilled。
- **凭据安全**: AI 提供商 Key 仅存于 DB（加密表），通过 `bootstrap-credentials` 一次性任务从 env 注入，运行时只读 DB，终端用户无需在设置页填 Key。
- **构建可重现性**: 所有依赖通过 `pnpm-lock.yaml` 锁定，Docker 构建使用 `--frozen-lockfile`，确保 deps/build/migrate/runtime 各阶段一致。
- **字体选择**: 生产镜像使用 fonts-wqy-zenhei（7.5MB）而非 fonts-noto-cjk（60.2MB），解决构建网络大文件下载失败问题。