---
kind: build_system
name: 构建与部署系统（Next.js + Worker 多容器编排）
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
    - next.config.ts
    - pnpm-workspace.yaml
    - drizzle.config.ts
---

## 1. 使用的系统与工具
- **包管理**: pnpm 10.30.0（通过 corepack 激活），采用 monorepo workspace 模式，根目录与 `server/` 两个 package。
- **前端框架**: Next.js 16.2.0，使用 Turbopack 构建，生产构建输出 `.next`。
- **测试**: Vitest 4.x，支持 PostgreSQL 集成测试（独立 vitest.pg.config.ts）。
- **数据库迁移**: Drizzle ORM + drizzle-kit，迁移脚本位于 `scripts/setup/db-migrate.ts`。
- **容器化**: Docker 多阶段构建，分别产出 Next 应用镜像与 server Worker 镜像。
- **编排**: docker-compose（dev/prod 两套 compose 文件），Caddy 作为反向代理。
- **开发脚本**: PowerShell 脚本 `scripts/dev/start-dev.ps1` 统一管理 dev 进程。

## 2. 关键文件与位置
- 根构建入口: `Dockerfile`（Next 应用）、`package.json`（pnpm scripts）、`next.config.ts`（构建配置）
- Worker 构建: `server/Dockerfile`、`server/package.json`、`server/src/index.ts`
- 反向代理: `deploy/reverse-proxy/Dockerfile` + `Caddyfile` + `entrypoint.sh`
- 编排文件: `docker-compose.dev.yml`、`docker-compose.prod.yml`
- Workspace: `pnpm-workspace.yaml`（定义 root + server 两个包）
- 迁移与初始化: `drizzle.config.ts`、`scripts/setup/*.ts`（db-migrate、bootstrap-credentials、seed-owner-account）
- 验证脚本: `scripts/verify/*.ts`（架构校验、E2E smoke）

## 3. 架构与约定
### 多阶段 Docker 构建
- **根 Dockerfile** 定义 deps → build → migrate → runtime 四个 stage：
  - `deps`: 仅安装依赖（跳过浏览器下载），复用 pnpm workspace 锁定文件
  - `build`: 执行 `next build`，生产环境移除 console.log（保留 error/warn）
  - `migrate`: 保留 devDependencies 用于一次性迁移任务
  - `runtime`: 最小运行镜像，按 playwright 实际版本安装 Chromium，以非 root 用户 `pwuser` 运行
- **server/Dockerfile** 独立构建 worker：直接运行 TS 源码（tsx），不预编译，共享根 node_modules
- 两个镜像均使用 `node:22-bookworm-slim` 基础镜像，避免官方 Playwright 镜像 tag 不可用的问题

### Monorepo 工作区
- `pnpm-workspace.yaml` 声明 root 和 server 两个包，依赖版本集中在根 `pnpm-lock.yaml`
- 构建时从仓库根上下文执行 `pnpm install --frozen-lockfile`，确保依赖一致性
- server 通过相对路径引用根 `src/` 的 TTS 配置模块（唯一跨目录引用）

### Next.js 反向代理策略
- 所有 `/api/engine/*` 请求通过 `next.config.ts` 的 rewrites 转发到 `BACKEND_ORIGIN`（默认 `http://localhost:8787`）
- 生产环境 worker 不对外暴露，仅内网访问；浏览器只接触单一域名
- `serverExternalPackages` 将 ffmpeg-static 和 pi-ai 包外部化，避免 Turbopack 动态 require 失败

### 容器编排与服务依赖
- **开发环境** (`docker-compose.dev.yml`): 仅启动 PostgreSQL，端口映射到 `127.0.0.1:54328`
- **生产环境** (`docker-compose.prod.yml`):
  - `reverse-proxy` (Caddy): 唯一对外端口 443，TLS + IP 过滤 + Basic Auth
  - `next`: replicas=1（因进程内状态机不支持多实例），健康检查 `/api/ping`
  - `worker`: 端口 8787 仅内网访问，环境变量注入 AI 提供商凭据
  - `postgres`: 持久卷存储，健康检查 `pg_isready`
  - `migrate`: 一次性迁移任务，依赖 postgres healthy
  - `bootstrap-credentials` / `seed-demo-account`: 基于 migrate target 的一次性初始化

### 构建约束与优化
- 禁止从 Windows 宿主 COPY `node_modules`，必须在 Linux 镜像内执行 `pnpm install` 以获得正确的平台二进制
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 在构建期跳过浏览器下载，运行时按需安装
- CJK 字体使用 `fonts-wqy-zenhei`（7.5MB）而非 `fonts-noto-cjk`（60.2MB），解决构建网络超时问题
- `onlyBuiltDependencies` 限制原生模块重建范围（esbuild、ffmpeg-static、sharp）
- 生产构建禁用 source maps（`productionBrowserSourceMaps: false`）保护代码

## 4. 约定与约束
- **Node 版本要求**: `engines.node >= 22.11.0`（package.json 声明）
- **pnpm 版本锁定**: 通过 `packageManager: "pnpm@10.30.0"` 和 corepack 强制版本
- **环境变量强制**: 生产 compose 中关键变量使用 `${VAR:?error}` 语法，缺失时报错退出
- **安全运行**: 所有容器以非 root 用户 `pwuser` 运行，Chromium 沙箱启用（加载模型生成 HTML 时需要）
- **单实例限制**: next 服务 replicas 固定为 1，因 stream-bus/status-bus 基于 globalThis 进程内状态
- **构建产物隔离**: 可通过 `CVC_NEXT_DIST_DIR` 环境变量指定独立 .next 目录，避免 dev/test 争用
- **日志策略**: 生产环境移除 console.log，但保留 error/warn 用于诊断（next.config.ts 明确注释原因）
- **依赖冻结**: 所有 Docker 构建使用 `--frozen-lockfile`，确保可重现构建
- **Playwright 版本对齐**: 运行时安装的 Chromium 版本通过 `require('./node_modules/playwright/package.json').version` 动态获取，与依赖锁定一致