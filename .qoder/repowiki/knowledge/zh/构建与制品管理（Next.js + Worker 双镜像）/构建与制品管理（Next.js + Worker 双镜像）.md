---
kind: build_system
name: 构建与制品管理（Next.js + Worker 双镜像）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - Dockerfile
    - server/package.json
    - server/Dockerfile
    - deploy/reverse-proxy/Dockerfile
    - docker-compose.dev.yml
    - docker-compose.prod.yml
    - next.config.ts
    - pnpm-workspace.yaml
    - scripts/dev/start-dev.ps1
---

本项目采用 pnpm monorepo 管理 Next.js 前端应用与独立 Node.js 渲染 Worker，通过多阶段 Docker 镜像完成构建、迁移与运行，生产编排由 docker-compose 统一调度。

**构建系统与技术栈**
- 包管理器：pnpm@10.30.0（通过 packageManager 字段锁定），Workspace 包含根目录与 server/ 两个包。
- 前端构建：Next.js 16，next build 产出 .next 产物；生产构建启用 removeConsole: { exclude: ['error','warn'] } 保留诊断日志。
- 后端运行：Worker 使用 tsx 直接执行 TypeScript 源码，无预编译步骤。
- 数据库迁移：drizzle-kit + tsx 脚本，通过 pnpm db:migrate 执行。
- 测试：Vitest（含 PostgreSQL 集成测试配置 vitest.pg.config.ts）。

**Docker 多阶段镜像架构**
- 根 Dockerfile（Next 应用）：
  - deps 阶段：在 Linux 镜像中 pnpm install --frozen-lockfile，跳过 Chromium 下载。
  - build 阶段：pnpm build 生成 .next 产物。
  - migrate 阶段：保留 devDependencies，作为一次性迁移任务入口。
  - runtime 阶段：安装 fonts-wqy-zenhei（替代体积过大的 noto-cjk）、Chromium 浏览器二进制，以非 root 用户 pwuser 运行，暴露 3000 端口。
- server/Dockerfile（Worker）：
  - 复用 workspace 的 pnpm install 结果，运行时通过 tsx 直接执行 server/src/index.ts，暴露 8787 端口。
  - 同样安装 CJK 字体与 Chromium，输出目录挂载到 /repo/server/out 和 /repo/server/capture。
- deploy/reverse-proxy/Dockerfile：基于 caddy:2.10-alpine，提供 TLS、IP 过滤与 Basic Auth 反向代理。

**生产编排（docker-compose.prod.yml）**
服务依赖顺序严格定义：postgres → migrate → bootstrap-credentials → seed-demo-account → next → worker → reverse-proxy。
- Next 应用固定 replicas=1（进程内状态机不支持多实例）。
- 所有敏感凭据通过环境变量注入，AI 凭据经 bootstrap-credentials 一次性写入加密存储后不再需要 env。
- Healthcheck 覆盖所有关键服务（Postgres pg_isready、Next /api/ping、Worker /health）。

**开发工作流**
- scripts/dev/start-dev.ps1 是 Windows PowerShell 启动器，自动完成工具链检查、Postgres 容器启动、依赖安装、迁移、端口冲突检测与进程拉起。
- 支持 -SkipDocker、-SkipInstall、-SkipMigrate、-NoWeb、-NoWorker 等参数灵活控制。
- 默认端口：Web 3000、Worker 8787，冲突时自动寻找空闲端口或按 -KillPort 终止占用进程。

**构建约束与约定**
- Node.js 版本要求 >=22.11.0（engines 字段锁定）。
- 仅允许构建依赖：esbuild、ffmpeg-static、sharp（pnpm.onlyBuiltDependencies）。
- Next 构建将 @earendil-works/pi-ai、@earendil-works/pi-agent-core、ffmpeg-static 外部化以避免 Turbopack 动态 require 问题。
- 生产镜像不启用 output: standalone，保留完整 node_modules 以兼容迁移脚本。