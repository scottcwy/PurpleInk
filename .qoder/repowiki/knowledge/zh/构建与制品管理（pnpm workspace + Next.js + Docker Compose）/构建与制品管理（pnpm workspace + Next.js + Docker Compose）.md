---
kind: build_system
name: 构建与制品管理（pnpm workspace + Next.js + Docker Compose）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - next.config.ts
    - vitest.config.ts
    - Dockerfile
    - server/Dockerfile
    - docker-compose.dev.yml
    - docker-compose.prod.yml
    - scripts/dev/start-dev.ps1
    - server/package.json
---

## 1. 使用的系统与工具链
- 包管理与工作区：pnpm workspace，根 `package.json` 与 `server/package.json` 两个子包通过 `pnpm-workspace.yaml` 聚合。
- 前端构建：Next.js 16（`next build`/`next start`），Turbopack 启用并通过 `serverExternalPackages` 排除动态 require 的依赖。
- 后端 Worker：基于 tsx 直接运行 TypeScript 源码（`tsx watch src/index.ts`），不产出独立产物。
- 测试：Vitest（`vitest.config.ts`、`vitest.pg.config.ts`），支持 Node 环境与 PostgreSQL 集成测试。
- 数据库迁移：Drizzle Kit（`drizzle.config.ts`），通过脚本 `scripts/setup/db-migrate.ts` 执行。
- 容器化：Docker 多阶段构建（根 `Dockerfile` 用于 Next 应用，`server/Dockerfile` 用于 worker），Docker Compose 编排生产与开发环境。
- 代码质量：ESLint（`eslint.config.mjs`）、Prettier（`.prettierrc`）。

## 2. 关键文件与位置
- 根构建入口：`package.json`（scripts、依赖、engines、pnpm 配置）、`next.config.ts`（Next 构建与反向代理重写）、`vitest.config.ts`、`tsconfig.json`、`postcss.config.mjs`、`drizzle.config.ts`。
- 工作区定义：`pnpm-workspace.yaml`。
- 容器镜像：`Dockerfile`（Next 应用）、`server/Dockerfile`（worker）。
- 编排文件：`docker-compose.dev.yml`（本地 Postgres）、`docker-compose.prod.yml`（完整生产栈：reverse-proxy、next、worker、postgres、migrate、bootstrap-credentials、seed-demo-account）。
- 开发启动器：`scripts/dev/start-dev.ps1`（PowerShell 一键拉起 Postgres、安装依赖、迁移、Next dev、worker dev，并做端口探测与健康检查）。
- Worker 配置：`server/package.json`、`server/.env.example`。
- 反向代理：`deploy/reverse-proxy/Dockerfile`、`deploy/reverse-proxy/Caddyfile`。

## 3. 架构与约定
- Monorepo 双端编排：根目录为 Next 前端，`server/` 为独立的 Worker 服务；两者共享同一 pnpm workspace，依赖版本锁定在根 `pnpm-lock.yaml`。
- 构建阶段分离：
  - deps：在 Linux 镜像内执行 `pnpm install --frozen-lockfile`，避免 Windows 宿主 node_modules 污染。
  - build：`NODE_ENV=production` 下执行 `pnpm build`，触发 Next 生产构建与 console 移除策略。
  - migrate：保留 devDependencies（tsx/drizzle-kit），作为一次性迁移任务。
  - runtime：仅拷贝必要产物（node_modules、.next、public、配置文件），非 root 用户运行。
- Worker 镜像以 tsx 直接运行源码，不编译产物，便于快速迭代；同时复制根 `src/` 中 TTS 配置模块供跨目录引用。
- Next 通过 `next.config.ts` 的 `rewrites` 将 `/api/engine/*` 透明转发到 `BACKEND_ORIGIN`（默认 `http://localhost:8787`），实现同源部署与内网通信。
- 生产编排严格限制 Next 副本数为 1（因进程内状态机），Worker 通过环境变量注入外部凭据，由 `bootstrap-credentials` 一次性写入加密存储。

## 4. 约定与约束
- Node 版本要求：`package.json` 的 `engines.node >= 22.11.0`，开发脚本强制校验最低版本。
- pnpm 版本锁定：`packageManager: pnpm@10.30.0`，开发脚本检测版本一致性。
- 构建产物隔离：Next 允许通过 `CVC_NEXT_DIST_DIR` 指定独立 `.next` 目录，避免与 dev server 争用。
- 生产构建安全：`compiler.removeConsole` 在生产环境仅保留 `error`/`warn`，禁用 source maps；`serverExternalPackages` 排除动态 require 的第三方包。
- Playwright 浏览器安装：通过 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 跳过构建期下载，运行时按实际安装的 playwright 版本动态安装 Chromium。
- 字体策略：使用 `fonts-wqy-zenhei`（7.5MB）替代 `fonts-noto-cjk`（60.2MB），解决构建网络大文件下载失败问题。
- 安全运行：容器内创建 `pwuser` 非 root 用户，Chromium 二进制与数据目录权限严格控制。
- 健康检查：Next 暴露 `/api/ping`，Worker 暴露 `/health`，Compose 通过 HTTP 探针验证服务就绪。
- 环境变量治理：开发脚本仅检查变量名存在性，不打印或记录值；生产 compose 对必需变量设置强制默认值与错误提示。
- 依赖补丁：通过 `pnpm.patchedDependencies` 对 `@earendil-works/pi-ai` 应用自定义 patch 文件。