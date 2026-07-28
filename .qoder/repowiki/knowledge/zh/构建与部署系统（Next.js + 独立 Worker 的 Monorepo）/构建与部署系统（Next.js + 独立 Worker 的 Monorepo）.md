---
kind: build_system
name: 构建与部署系统（Next.js + 独立 Worker 的 Monorepo）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - next.config.ts
    - Dockerfile
    - server/Dockerfile
    - deploy/reverse-proxy/Dockerfile
    - docker-compose.dev.yml
    - docker-compose.prod.yml
    - pnpm-workspace.yaml
    - scripts/dev/start-dev.ps1
    - server/package.json
    - drizzle.config.ts
    - vitest.config.ts
---

## 1. 使用的系统与工具
- **包管理器**：pnpm 10.30.0（通过 `packageManager` 字段锁定），采用 pnpm workspace 管理根 Next 应用与 `server/` 渲染 Worker 两个子项目。
- **前端框架**：Next.js 16（`next build` / `next start`），配合 Turbopack、Tailwind CSS v4、PostCSS。
- **后端运行时**：Worker 使用 tsx 直接运行 TypeScript 源码（`tsx src/index.ts`），不预编译产物。
- **容器化**：多阶段 Dockerfile（根 `Dockerfile` 构建 Next 镜像，`server/Dockerfile` 构建 Worker 镜像，`deploy/reverse-proxy/Dockerfile` 基于 caddy:2.10-alpine）。
- **编排**：docker-compose.dev.yml（开发 Postgres）、docker-compose.prod.yml（生产反向代理 + Next + Worker + Postgres + 一次性迁移/初始化任务）。
- **数据库迁移**：Drizzle Kit（`drizzle.config.ts` 指向 PostgreSQL，schema 位于 `src/lib/db/schema/index.ts`，迁移输出到 `src/lib/db/migrations/pg`）。
- **测试**：Vitest（`vitest.config.ts` 与 `vitest.pg.config.ts` 分离普通测试与 PostgreSQL 集成测试）。
- **代码质量**：ESLint 9 + Prettier 3（含 Tailwind 插件）。

## 2. 关键文件与位置
- 根构建入口：`package.json`（scripts 定义 dev/build/start/lint/format/test/typecheck 等）
- Next 构建配置：`next.config.ts`（Turbopack root、serverExternalPackages、removeConsole、rewrites 反向代理到 worker）
- 根应用镜像：`Dockerfile`（deps → build → migrate → runtime 四阶段，Node 22 bookworm-slim，Chromium 按 playwright 版本安装）
- Worker 镜像：`server/Dockerfile`（复用 workspace node_modules，tsx 直跑 TS，COPY 根 `src/` 供跨目录引用 TTS 配置）
- 反向代理镜像：`deploy/reverse-proxy/Dockerfile`（Caddy + Caddyfile + entrypoint.sh）
- 开发启动脚本：`scripts/dev/start-dev.ps1`（PowerShell 一键拉起 Postgres → install → migrate → worker → next，端口冲突检测与健康检查）
- Compose 编排：`docker-compose.dev.yml`、`docker-compose.prod.yml`
- Workspace 声明：`pnpm-workspace.yaml`（packages: ".", "server"）
- Drizzle 配置：`drizzle.config.ts`
- Vitest 配置：`vitest.config.ts`、`vitest.pg.config.ts`
- Worker 依赖与脚本：`server/package.json`（dev/start/capture/render/verify:golden）

## 3. 架构与设计决策
- **Monorepo 双进程模型**：Next 作为前端 + API 网关，通过 `next.config.ts` 的 rewrites 将 `/api/engine/*` 反向代理到独立 Worker（默认 `http://localhost:8787`，生产由 `BACKEND_ORIGIN` 注入）。两者共享同一 pnpm workspace 的依赖解析，但运行时完全隔离。
- **多阶段 Docker 构建**：每个镜像都遵循 deps → build/runtime 的分层策略，利用 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 在构建期跳过浏览器下载，运行期再按实际安装的 playwright 版本安装 Chromium，确保二进制版本一致。
- **非 root 运行**：所有容器以 `pwuser` 用户运行，Chromium 安装在 `/ms-playwright`，数据目录 `/app/.data` 或 `/repo/server/out` 归 pwuser 所有。
- **CJK 字体策略**：选用 `fonts-wqy-zenhei`（7.5MB）而非 `fonts-noto-cjk`（60.2MB），解决大文件下载中断问题，满足中文渲染需求。
- **构建产物差异**：Next 走标准 `next build` 产出 `.next`；Worker 不构建产物，直接 `tsx` 执行源码，便于快速迭代。
- **环境变量分层**：`.env` / `.env.local` 用于本地开发，Compose 通过 `${VAR}` 注入生产密钥，敏感信息通过 Docker secrets（如 `basic_auth_credentials`）挂载。
- **健康检查与就绪探针**：Next 暴露 `/api/ping`，Worker 暴露 `/health`，Compose 对每个服务配置 healthcheck，确保依赖顺序正确启动。

## 4. 约定与约束
- **Node 版本要求**：`engines.node >= 22.11.0`，开发脚本强制校验 Node 主版本 ≥ 22、次版本 ≥ 11。
- **pnpm 版本锁定**：`packageManager: pnpm@10.30.0`，开发脚本会警告版本不一致但不阻断。
- **依赖安装策略**：仅允许 `esbuild`、`ffmpeg-static`、`sharp` 作为 native addon 构建（`onlyBuiltDependencies`），其余纯 JS 依赖跳过原生编译。
- **补丁机制**：通过 `patches/@earendil-works__pi-ai.patch` 修补第三方包，由 `pnpm patchedDependencies` 声明。
- **构建期 console 清理**：生产环境 `removeConsole: { exclude: ["error", "warn"] }`，保留错误与警告日志以便诊断。
- **外部包排除打包**：`serverExternalPackages` 包含 `ffmpeg-static`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`，避免 Turbopack 动态 require 失败。
- **反向代理边界**：Next 统一对外暴露 `/api/*`，Worker 不直接对外暴露（生产通过内网 `BACKEND_ORIGIN` 访问）。
- **单实例限制**：Next 在生产 compose 中固定 `replicas: 1`，因 stream-bus/status-bus 依赖进程内 globalThis 状态，多实例不安全。
- **迁移与初始化顺序**：`migrate` → `bootstrap-credentials` → `seed-demo-account` → `next` → `worker`，严格依赖链保证数据就绪。
- **端口分配策略**：开发脚本支持 `-StrictPort`（严格失败）或自动寻找空闲端口并调整 `BACKEND_ORIGIN`，避免端口冲突。
- **测试分离**：普通测试通过 `vitest run`，PostgreSQL 集成测试通过 `vitest run --config vitest.pg.config.ts`，后者显式包含 `*.pg.test.ts`。