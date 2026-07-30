---
kind: build_system
name: 构建与部署系统（pnpm monorepo + Docker Compose）
category: build_system
scope:
    - '**'
source_files:
    - Dockerfile
    - server/Dockerfile
    - deploy/reverse-proxy/Dockerfile
    - package.json
    - server/package.json
    - next.config.ts
    - docker-compose.dev.yml
    - docker-compose.prod.yml
    - pnpm-workspace.yaml
    - scripts/dev/start-dev.ps1
---

## 1. 系统与工具链
- 包管理：pnpm 10.30.0（通过 `packageManager` 字段锁定），采用 pnpm workspace 管理根 Next.js 应用与 `server/` 独立 worker 两个子包。
- Node 版本：要求 `>=22.11.0`，由 `engines` 字段与开发启动脚本共同校验。
- 构建器：Next.js 16（`next build`），生产镜像未启用 `output: 'standalone'`，直接打包完整 `node_modules` 以兼容迁移用的 `tsx`。
- 运行时执行：Next 通过 `node node_modules/next/dist/bin/next start` 直接调用真实入口；worker 使用 `tsx` 直接运行 TS 源码（`server/package.json` 的 `start` 脚本）。
- 容器化：Docker 多阶段构建，分别产出 Next 应用镜像、worker 镜像与 Caddy 反向代理镜像。
- 编排：docker-compose 提供 dev（仅 Postgres）与 prod（reverse-proxy + next + worker + postgres + migrate + bootstrap-credentials + seed-demo-account）两套编排。

## 2. 关键文件与位置
- 根构建配置：`Dockerfile`（Next 应用）、`package.json`（scripts、依赖、pnpm 配置）、`next.config.ts`（重写 `/api/engine/*` → `BACKEND_ORIGIN`、`serverExternalPackages`、`removeConsole` 策略）
- Worker 构建：`server/Dockerfile`、`server/package.json`（tsx 直跑模式）
- 反向代理：`deploy/reverse-proxy/Dockerfile` + `Caddyfile`（443 端口暴露 TLS + Basic Auth + IP 白名单）
- 编排：`docker-compose.dev.yml`（Postgres 开发库）、`docker-compose.prod.yml`（全栈生产编排）
- 本地开发启动：`scripts/dev/start-dev.ps1`（PowerShell 一键拉起 Postgres、安装依赖、执行迁移、启动 Next 与 worker、健康探测）
- 工作区：`pnpm-workspace.yaml`（声明 `.` 与 `server` 两个包）

## 3. 架构与约定
- Monorepo 双进程模型：Next 前端作为唯一对外入口（443），通过 `next.config.ts` 的 `rewrites` 将 `/api/engine/:path*` 转发到内网 worker（`BACKEND_ORIGIN`），浏览器无跨域问题。
- 多阶段镜像分层：
  - `deps`：在 Linux 镜像中 `pnpm install --frozen-lockfile`，设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 跳过浏览器下载。
  - `build`：`pnpm build` 生成 `.next` 产物。
  - `migrate`：保留 devDependencies（tsx / drizzle-kit），用于一次性迁移任务。
  - `runtime`：安装 CJK 字体（fonts-wqy-zenhei，7.5MB 而非 60MB 的 noto-cjk）、Chromium 浏览器二进制（非 root 用户 pwuser 运行）、拷贝必要产物。
- Worker 镜像独立但复用 workspace 依赖解析：`server/Dockerfile` 同样从仓库根上下文构建，确保 `pnpm-lock.yaml` 一致。
- 数据库迁移与初始化：compose 中 `migrate` target 先于 next 完成；`bootstrap-credentials` 将 env 中的明文 Key 经 API 校验后写入加密存储；`seed-demo-account` 可选创建演示账号。
- 并发控制：生产环境必须显式设置 `CVC_QUEUE_RENDER_SHOT_CONCURRENCY` 与 `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY`，因为容器内 CPU 核数读取宿主而非 cgroup 限额。
- 安全基线：worker 与 runtime 均以非 root 用户 `pwuser` 运行；Playwright 沙箱不关闭（加载模型生成的 HTML 需要沙箱防护）。

## 4. 约定与约束
- **包管理器锁定**：`packageManager: pnpm@10.30.0`，开发脚本严格校验该版本，不一致会告警。
- **Node 版本下限**：`engines.node >= 22.11.0`，`start-dev.ps1` 在 toolchain preflight 阶段强制校验。
- **依赖安装**：`pnpm install --frozen-lockfile`，禁止锁文件漂移；`onlyBuiltDependencies` 仅允许 esbuild、ffmpeg-static、sharp 原生编译。
- **构建产物**：生产构建禁用 source maps（`productionBrowserSourceMaps: false`），并移除 console.log 但保留 error/warn 以便诊断。
- **外部包处理**：`serverExternalPackages` 将 `ffmpeg-static`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core` 外部化，避免 Turbopack 动态 require 失败。
- **环境变量注入**：生产 compose 通过 `${VAR:?error}` 强制必填变量（如 `POSTGRES_PASSWORD`、`CVC_CREDENTIAL_MASTER_KEY`、各 API Key），缺失时直接报错退出。
- **服务单实例**：next 服务固定 `replicas: 1`，因 stream-bus / status-bus 基于进程内 globalThis 锚定，多实例不安全。
- **端口分配**：开发脚本自动检测端口冲突，支持 `-KillPort` 强杀占用进程或 `-StrictPort` 严格失败，默认自动寻找空闲端口。
- **健康检查**：next 通过 `/api/ping`、worker 通过 `/health` 暴露健康端点，compose 定义 healthcheck 保证依赖顺序。
- **浏览器依赖**：Chromium 系统依赖与二进制分两步安装，浏览器路径通过 `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` 指向共享目录，便于卷挂载。
- **字体选择**：统一使用 fonts-wqy-zenhei（7.5MB）替代 fonts-noto-cjk（60.2MB），解决构建网络大文件下载中断问题。