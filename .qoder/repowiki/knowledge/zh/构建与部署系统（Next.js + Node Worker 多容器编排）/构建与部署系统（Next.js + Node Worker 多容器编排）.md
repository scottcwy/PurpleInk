---
kind: build_system
name: 构建与部署系统（Next.js + Node Worker 多容器编排）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - Dockerfile
    - server/package.json
    - server/Dockerfile
    - next.config.ts
    - pnpm-workspace.yaml
    - docker-compose.dev.yml
    - docker-compose.prod.yml
    - scripts/dev/start-dev.ps1
    - vitest.config.ts
    - vitest.pg.config.ts
    - deploy/reverse-proxy/Caddyfile
---

## 1. 使用的系统与工具链
- **包管理器**：pnpm 10.30.0（通过 `packageManager` 字段锁定，`corepack enable pnpm@10.30.0 --activate` 在 Docker 中启用）
- **前端框架**：Next.js 16.2.0（App Router），生产构建走 `next build`，运行 `next start`
- **后端服务**：独立 Node/TS worker（`server/`），使用 `tsx` 直接执行源码（开发/生产均不预编译）
- **测试框架**：Vitest 4.x（`vitest.config.ts` + `vitest.pg.config.ts` 分离 PostgreSQL 集成测试）
- **数据库迁移**：Drizzle Kit（`drizzle-kit generate` / `pnpm db:migrate`）
- **容器化**：Docker 多阶段构建（根 `Dockerfile` 负责 Next 应用，`server/Dockerfile` 负责 worker）
- **编排**：docker-compose（`docker-compose.dev.yml` 开发、`docker-compose.prod.yml` 生产）
- **代码质量**：ESLint 9 + Prettier 3 + TypeScript strict mode

## 2. 关键文件与位置
- 根构建入口：`package.json`（scripts）、`Dockerfile`（Next 应用镜像）、`next.config.ts`（构建期配置）
- Worker 构建：`server/package.json`、`server/Dockerfile`、`server/.env`（运行时配置）
- 工作区：`pnpm-workspace.yaml`（定义 `.` 和 `server` 两个包）
- 开发启动器：`scripts/dev/start-dev.ps1`（PowerShell 一键拉起 Postgres → 依赖安装 → 迁移 → Next + Worker）
- 环境编排：`docker-compose.dev.yml`（Postgres 开发库）、`docker-compose.prod.yml`（完整生产栈）
- 反向代理：`deploy/reverse-proxy/Caddyfile` + `deploy/reverse-proxy/Dockerfile`（Caddy TLS + Basic Auth + IP 白名单）
- 测试配置：`vitest.config.ts`、`vitest.pg.config.ts`
- 补丁：`patches/@earendil-works__pi-ai.patch`（pnpm patchedDependencies）

## 3. 架构与约定
### 多阶段 Docker 构建
- **根 Dockerfile** 分 4 个 stage：`deps`（pnpm install，跳过浏览器下载）→ `build`（`next build`）→ `migrate`（保留 devDependencies 用于一次性迁移）→ `runtime`（仅拷贝 `.next/public/node_modules`，非 root 用户 `pwuser` 运行，Chromium 按 node_modules 版本动态安装）
- **server/Dockerfile** 同样分 `deps` + `runtime`，worker 以 `tsx server/src/index.ts` 直接运行 TS 源码，不产出中间产物
- 两镜像共享同一份 `pnpm-lock.yaml`，确保依赖解析一致

### 前后端通信模式
- Next 通过 `next.config.ts` 的 `rewrites` 将 `/api/engine/:path*` 反向代理到 `BACKEND_ORIGIN`（默认 `http://localhost:8787`）
- Worker 不对外暴露端口，仅被 Next 内网访问；生产由 Caddy 作为唯一 443 入口

### 开发工作流
- `pnpm dev:all` 调用 PowerShell 脚本，自动完成：工具链检查 → .env 校验 → Docker Postgres 启动 → pnpm install → drizzle 迁移 → 分别打开独立窗口运行 Next(3000) 与 Worker(8787) → HTTP 就绪探测
- 端口冲突自动检测并可选 kill/shift；支持 `-SkipDocker`、`-NoWeb`、`-NoWorker` 等开关

### 生产部署拓扑
- `reverse-proxy`（Caddy，443）→ `next`（Next 应用，replicas=1，因 stream-bus/globalThis 进程内状态不可水平扩展）→ `postgres`（持久卷）+ `worker`（渲染/采集）+ `migrate`（一次性）+ `bootstrap-credentials`（凭据注入）+ `seed-demo-account`（可选演示账号）
- 所有敏感凭据通过环境变量或 Docker secrets 注入，运行时只读 DB 加密存储

## 4. 约定与约束
- **Node 版本**：`engines.node >= 22.11.0`，开发脚本强制校验最低版本
- **pnpm 版本**：`packageManager: pnpm@10.30.0`，开发脚本严格匹配该版本
- **构建产物**：Next 生产构建禁用 source maps（`productionBrowserSourceMaps: false`），移除 console.log 但保留 error/warn 用于诊断
- **外部包**：`ffmpeg-static`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core` 必须 externalize，避免 Turbopack 破坏动态 require
- **浏览器依赖**：Playwright Chromium 按 `node_modules/playwright/package.json` 中的版本号动态安装，禁止跨平台 COPY node_modules
- **字体策略**：使用 `fonts-wqy-zenhei`（7.5MB）替代 `fonts-noto-cjk`（60.2MB），解决构建网络大文件中断问题
- **安全运行**：容器内以非 root `pwuser` 运行，Chromium 沙箱关闭（加载模型生成 HTML 需要）
- **并发控制**：生产 compose 要求显式设置 `CVC_QUEUE_RENDER_SHOT_CONCURRENCY` 与 `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY`，防止按宿主核数开并发导致 OOMKilled
- **单实例限制**：Next 服务 replicas 固定为 1，因进程内全局状态（stream-bus/status-bus）不支持多副本
- **依赖管理**：`pnpm.onlyBuiltDependencies` 限定 `esbuild`、`ffmpeg-static`、`sharp` 三个原生包，减少镜像体积
- **测试隔离**：`.pg.test.ts` 后缀文件通过独立 vitest 配置运行，需真实 PostgreSQL 连接
- **环境优先级**：`.env` → `.env.local`（Next 兼容），开发脚本仅读取键名不打印值，遵循 AGENTS.md 保密约定