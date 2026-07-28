---
kind: build_system
name: 构建与制品管理（pnpm 工作区 + Docker 多阶段镜像）
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
    - drizzle.config.ts
    - vitest.config.ts
---

## 1. 系统/工具栈概览
- 包管理：pnpm workspace 聚合根 Next.js 应用与 server/ Worker 两个子包，锁定 pnpm@10.30.0（packageManager 字段），Node >= 22.11.0。
- 构建器：Next.js 16（next build），Turbopack 通过 next.config.ts 固定 root；生产构建启用 removeConsole 但保留 error/warn 以便诊断。
- 测试：Vitest 4（vitest.config.ts 与 vitest.pg.config.ts 分离 Postgres 集成测试），Playwright 用于截图/E2E。
- 数据库迁移：Drizzle Kit（drizzle.config.ts 指向 PostgreSQL schema，输出到 src/lib/db/migrations/pg）。
- 容器化：Docker 多阶段镜像（根 Dockerfile 构建 Next，server/Dockerfile 构建 Worker），docker-compose.dev.yml / docker-compose.prod.yml 编排服务。
- 开发启动：PowerShell 脚本 scripts/dev/start-dev.ps1 统一完成工具链检查、Postgres 拉起、依赖安装、迁移、并行启动 Next 与 Worker、健康探测与端口冲突处理。

## 2. 关键文件与职责
- 根 package.json：定义 dev/build/start/lint/format/test/typecheck 等脚本，dev:all/dev:status/dev:stop 调用 PowerShell 启动脚本，db:migrate 走 tsx 执行迁移。
- pnpm-workspace.yaml：声明 packages: [".", "server"]，实现跨包依赖解析与 frozen-lockfile 构建。
- next.config.ts：配置 serverExternalPackages（ffmpeg-static、pi-ai、pi-agent-core）、removeConsole 策略、rewrites（/api/engine/* → BACKEND_ORIGIN）与 distDir 可插拔。
- Dockerfile（根）：三阶段（deps → build → runtime），非 root pwuser 运行，按 node_modules 中 playwright 版本动态 install chromium，字体选用 fonts-wqy-zenhei。
- server/Dockerfile：独立运行时镜像，tsx 直接执行 TS 源码，复制根 src/ 以支持 worker 对 TTS 配置的跨目录引用。
- deploy/reverse-proxy/Dockerfile：基于 caddy:2.10-alpine，entrypoint.sh 注入 Basic Auth 凭据并启动。
- docker-compose.dev.yml：仅编排 postgres 容器，挂载初始化 SQL，healthcheck 就绪后供本地开发。
- docker-compose.prod.yml：完整生产编排（reverse-proxy → next → worker → postgres → migrate → bootstrap-credentials → seed-demo-account），严格 replicas=1，环境变量强制校验（? 语法）。
- drizzle.config.ts：PostgreSQL dialect，schema 路径与 migrations 输出目录。
- vitest.config.ts：node 环境，别名 @→src，排除 *.pg.test.ts（由 vitest.pg.config.ts 单独执行）。
- scripts/dev/start-dev.ps1：一站式本地开发编排器，参数化 WebPort/WorkerPort/SkipDocker/SkipInstall/SkipMigrate/NoWeb/NoWorker/KillPort/StrictPort/OpenBrowser/Log 等。

## 3. 架构与约定
- 多包工作区：根与 server/ 共享 pnpm-lock.yaml，构建时以仓库根为上下文，确保依赖版本一致。
- 前后端通信：Next 通过 rewrites 将 /api/engine/* 反向代理到 BACKEND_ORIGIN（默认 http://localhost:8787），生产环境 worker 不对外暴露。
- 容器分层：deps 层缓存 pnpm install 结果，build 层执行 next build，runtime 层仅包含 .next/public/node_modules，最小化体积。
- 浏览器依赖：Playwright Chromium 在 runtime 阶段按实际版本安装，避免 Windows 宿主二进制污染 Linux 镜像。
- 安全运行：非 root 用户 pwuser，PLAYWRIGHT_BROWSERS_PATH=/ms-playwright，数据目录 /app/.data 或 /repo/server/out 归 pwuser 所有。
- 迁移与引导：migrate target 镜像作为一次性任务，bootstrap-credentials 与 seed-demo-account 通过 entrypoint 覆盖默认命令，依赖 completed_successfully 条件。
- 环境变量治理：生产 compose 使用 ${VAR:?message} 强制必填；演示账号变量刻意不用 NEXT_PUBLIC_* 避免构建期内联。

## 4. 约定与约束（从实现可见的约束）
- Node/pnpm 版本：package.json engines 要求 Node >= 22.11.0，packageManager 锁定 pnpm@10.30.0，start-dev.ps1 会校验并提示差异。
- 构建产物：next build 输出 .next，生产 CMD 直接执行 node node_modules/next/dist/bin/next start（绕过 pnpm shim）。
- 控制台输出：生产 removeConsole 仅排除 error/warn，禁止移除 warn 否则无法定位模型调用失败等关键错误。
- 外部包：serverExternalPackages 必须包含 ffmpeg-static、@earendil-works/pi-ai、@earendil-works/pi-agent-core，否则 Turbopack 打包后动态 require 失败。
- 数据库连接：DATABASE_URL 在 dev/prod 均通过环境变量注入，不得硬编码；postgres 健康检查使用 pg_isready。
- 并发限制：CVC_QUEUE_RENDER_SHOT_CONCURRENCY 与 CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY 必须在生产显式设置，否则按宿主核数并发导致 OOM。
- 单实例部署：next 服务 replicas=1，因 stream-bus/status-bus 使用进程内 globalThis 状态，多实例不安全。
- 字体选择：fonts-wqy-zenhei 替代 fonts-noto-cjk，解决大文件下载中断问题，满足中文渲染需求。
- 测试隔离：*.pg.test.ts 仅在 vitest.pg.config.ts 下运行，普通 vitest 排除该模式。
- 依赖安装：pnpm install --frozen-lockfile 用于构建镜像，确保可重现；本地开发通过 start-dev.ps1 检测 lockfile 时间戳决定是否重装。
- 反向代理：Caddy 通过 secrets 文件注入 basic_auth_credentials，CVC_ALLOWED_CIDRS 控制 IP 白名单。

## 5. 典型流程
- 本地开发：pnpm dev:all → start-dev.ps1 → 检查工具链/环境变量 → docker compose up postgres → pnpm install → pnpm db:migrate → 并行启动 worker(8787) 与 web(3000) → HTTP 健康探测 → 可选打开浏览器。
- 生产构建：docker build -t purpleink-app . → 三阶段构建（deps/build/runtime）→ docker compose -f docker-compose.prod.yml up -d → reverse-proxy(443) → next(3000) → worker(8787) → postgres(5432)。
- 迁移与引导：migrate target 先于 next 启动完成；bootstrap-credentials 将 env Key 写入加密存储；seed-demo-account 按需创建体验账号。

## 6. 相关脚本与验证
- scripts/verify/*：auth-flow-smoke.mjs、e2e-smoke.ts、capture-v3-baseline.ts、v3-architecture.ts 等，提供架构基线比对与冒烟验证。
- tests/*：Vitest 契约测试覆盖路由、TTS、UI、环境变量、Worker 错误处理等。
- .playwright-cli/*：大量 console/page 截图与 YAML 记录，反映 E2E 执行产物。

置信度：high（存在完整的 pnpm workspace、Docker 多阶段镜像、Compose 编排、PowerShell 开发启动器与 Drizzle 迁移体系，证据充分且贯穿全仓）