---
kind: build_system
name: 构建与部署系统（Next.js + 独立 Worker 双镜像）
category: build_system
scope:
    - '**'
source_files:
    - Dockerfile
    - server/Dockerfile
    - deploy/reverse-proxy/Dockerfile
    - docker-compose.prod.yml
    - docker-compose.dev.yml
    - package.json
    - pnpm-workspace.yaml
    - next.config.ts
---

## 1. 构建系统与工具链
- **包管理器**：pnpm@10.30.0（通过 `packageManager` 字段锁定），采用 pnpm workspace 管理根 Next.js 应用与 `server/` 独立 worker 两个子包。
- **运行时**：Node.js ≥22.11.0，生产构建基于 `node:22-bookworm-slim` 基础镜像。
- **前端构建**：Next.js 16.2.0，使用 Turbopack；通过 `next.config.ts` 配置 `serverExternalPackages`、`removeConsole`、`rewrites`（将 `/api/engine/*` 反向代理到 `BACKEND_ORIGIN` 指向的 worker）。
- **测试**：Vitest 4.x（`vitest.config.ts`），PostgreSQL 集成测试通过 `vitest.pg.config.ts` 单独运行。
- **类型检查**：TypeScript 5.x，`tsc --noEmit` 作为 typecheck 脚本。
- **代码质量**：ESLint 9 + Prettier 3，分别提供 lint/fix 与 format/format:check 脚本。
- **数据库迁移**：Drizzle Kit 0.31，`db:migrate` 通过 tsx 执行 `scripts/setup/db-migrate.ts`。

## 2. 多阶段 Docker 构建
仓库包含三套独立的 Dockerfile，形成「Next 应用镜像 + Worker 镜像 + Caddy 反向代理」的完整产物：

- **根 `Dockerfile`**（Next 应用）：
  - `deps` 阶段：`corepack enable` + `pnpm install --frozen-lockfile`，设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 跳过浏览器下载。
  - `build` 阶段：`pnpm build` 生成 `.next` 产物。
  - `migrate` 阶段：保留 devDependencies（tsx/drizzle-kit），ENTRYPOINT 为 `pnpm db:migrate`，供一次性迁移任务复用。
  - `runtime` 阶段：安装 `fonts-wqy-zenhei`（CJK 字体）、Chromium 依赖、以非 root 用户 `pwuser` 运行；CMD 直接调用 `node node_modules/next/dist/bin/next start`。

- **`server/Dockerfile`**（渲染 Worker）：
  - 同样基于 `node:22-bookworm-slim`，复用根 workspace 的 `pnpm install` 结果。
  - 运行时通过 `tsx` 直接执行 TS 源码（`server/src/index.ts`），不预编译。
  - 复制 `src/` 目录以支持 worker 对根 `src/lib/tts/config` 的跨目录引用。
  - 暴露 8787 端口，健康检查 `/health`。

- **`deploy/reverse-proxy/Dockerfile`**（Caddy 反向代理）：
  - 基于 `caddy:2.10-alpine`，挂载 `Caddyfile` 和 `entrypoint.sh`。
  - 作为唯一对外暴露的服务（443 端口），承担 TLS、IP 白名单、Basic Auth。

## 3. 容器编排（docker-compose）
- **开发环境** (`docker-compose.dev.yml`)：仅启动 PostgreSQL 17.5 Alpine，映射 127.0.0.1:54328:5432，含健康检查和初始化 SQL。
- **生产环境** (`docker-compose.prod.yml`)：定义 6 个服务及其依赖关系：
  - `reverse-proxy` → `next`（依赖 healthcheck）
  - `next` → `postgres`（healthy）+ `migrate`（completed_successfully）+ `bootstrap-credentials` + `seed-demo-account`
  - `worker`：独立进程，通过 `BACKEND_ORIGIN=http://worker:8787` 被 next 内网访问
  - `migrate`：一次性迁移任务
  - `bootstrap-credentials`：从环境变量校验并写入加密凭据存储
  - `seed-demo-account`：可选的演示账号创建
  - `postgres`：持久化数据卷

## 4. 构建约定与约束
- **依赖冻结**：所有 `pnpm install` 均使用 `--frozen-lockfile`，确保可重复构建。
- **浏览器二进制隔离**：Chromium 在 runtime 阶段按 `node_modules/playwright/package.json` 中实际版本安装，避免 Windows/Mac 宿主污染 Linux 镜像。
- **非 root 运行**：容器内统一使用 `pwuser` 用户，Playwright 浏览器路径固定为 `/ms-playwright`。
- **单实例部署**：Next 服务 replicas 固定为 1，因 stream-bus/status-bus 使用进程内 globalThis 锚定，多实例不安全。
- **环境变量强制校验**：生产 compose 中关键变量（如 `POSTGRES_PASSWORD`、`CVC_MANAGED_*_API_KEY`、`CVC_QUEUE_*_CONCURRENCY`）使用 `${VAR:?message}` 语法强制必填。
- **构建产物最小化**：runtime 镜像仅拷贝 `node_modules`、`.next`、`public`、`next.config.ts`、`package.json`，不携带 `src/` 源码。
- **pnpm onlyBuiltDependencies**：显式声明 `esbuild`、`ffmpeg-static`、`sharp` 为需本地编译的依赖，减少无关构建。
- **补丁机制**：通过 `patches/@earendil-works__pi-ai.patch` 对第三方包进行热修复。

## 5. 关键脚本与入口
- `pnpm dev` / `pnpm build` / `pnpm start`：Next.js 标准生命周期
- `pnpm dev:worker`：启动独立 worker 服务
- `pnpm dev:all` / `dev:status` / `dev:stop`：PowerShell 脚本统一管理开发环境
- `pnpm verify:v3` / `verify:managed-services` / `verify:e2e`：架构验证与冒烟测试
- `pnpm db:migrate`：数据库迁移
- `pnpm test` / `test:pg`：单元测试与 PostgreSQL 集成测试

## 6. 发布流程要点
- 构建上下文始终为仓库根目录，确保 pnpm workspace 依赖解析一致。
- 迁移与凭据注入通过 `target: migrate` 复用同一镜像，避免多份构建产物。
- 生产部署顺序严格遵循 compose 依赖图：postgres → migrate → bootstrap-credentials → seed-demo-account → next → reverse-proxy。
- 反向代理层（Caddy）负责 TLS 终止与访问控制，应用层不直接暴露端口。