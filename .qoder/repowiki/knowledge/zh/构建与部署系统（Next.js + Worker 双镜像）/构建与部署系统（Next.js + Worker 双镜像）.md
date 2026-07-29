---
kind: build_system
name: 构建与部署系统（Next.js + Worker 双镜像）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - Dockerfile
    - server/Dockerfile
    - docker-compose.dev.yml
    - docker-compose.prod.yml
    - pnpm-workspace.yaml
    - next.config.ts
    - vitest.config.ts
    - drizzle.config.ts
    - server/package.json
---

本项目采用 pnpm monorepo 管理 Next.js 前端应用与独立 Node 渲染 worker，通过多阶段 Docker 构建生成两个生产镜像，配合 docker-compose 编排反向代理、数据库、迁移与初始化任务。

### 1. 构建工具链
- 包管理器：pnpm@10.30.0（package.json 中 packageManager 字段锁定），使用 pnpm-workspace.yaml 将根目录与 server/ 声明为 workspace 包。
- 前端构建：Next.js 16（next build），启用 Turbopack；生产构建通过 next.config.ts 的 compiler.removeConsole 移除 console，但保留 error/warn 用于诊断。
- 后端运行：worker 不预编译，直接以 tsx src/index.ts 运行 TypeScript 源码（server/package.json 的 start 脚本）。
- 类型检查：tsc --noEmit（根与 server 各自提供 typecheck 脚本）。
- 测试框架：Vitest 4（vitest run），PostgreSQL 集成测试通过独立配置 vitest.pg.config.ts 运行。
- 数据库迁移：Drizzle Kit（drizzle-kit generate / db:migrate），schema 位于 src/lib/db/schema/index.ts，迁移输出至 src/lib/db/migrations/pg。

### 2. Docker 多阶段构建
根 Dockerfile 定义四个阶段：
- deps：仅安装依赖（跳过 Chromium 下载），复用 pnpm workspace 缓存。
- build：执行 pnpm build 生成 .next 产物。
- migrate：保留 devDependencies（tsx/drizzle-kit），作为一次性迁移入口。
- runtime：最小运行时镜像，安装 CJK 字体（fonts-wqy-zenhei，7.5MB）、Chromium、非 root 用户 pwuser，直接 node node_modules/next/dist/bin/next start。

server/Dockerfile 是独立的 worker 镜像：
- 同样基于 node:22-bookworm-slim，复用根 workspace 的 pnpm install 结果。
- 运行时直接 tsx server/src/index.ts，无需预构建。
- 挂载 /repo/server/out 与 /repo/server/capture 卷供持久化。

### 3. 服务编排（docker-compose）
- 开发环境（docker-compose.dev.yml）：仅启动 PostgreSQL 17 Alpine，端口映射到 127.0.0.1:54328，带健康检查与初始化 SQL。
- 生产环境（docker-compose.prod.yml）：完整编排 6 个服务：
  - reverse-proxy：Caddy 反向代理，唯一对外暴露 443 端口，支持 TLS、IP 白名单、Basic Auth。
  - next：Next.js 应用，单副本（replicas: 1，因 stream-bus/status-bus 使用进程内 globalThis 锚定），healthcheck 调用 /api/ping。
  - worker：渲染 worker，端口 8787，仅内网访问。
  - postgres：PostgreSQL 17，持久卷存储。
  - migrate：一次性迁移任务，依赖 postgres healthy。
  - bootstrap-credentials / seed-demo-account：一次性凭据注入与演示账号创建。

### 4. 关键构建约定与约束
- Node 版本：要求 >=22.11.0（engines.node），所有镜像均基于 node:22-bookworm-slim。
- Playwright 浏览器：不使用官方 Playwright 镜像（tag 404），改为在 runtime 阶段按 node_modules/playwright/package.json 中实际版本动态安装 Chromium。
- 环境变量强制校验：生产 compose 中使用 ${VAR:?message} 语法确保必需变量存在（如 POSTGRES_PASSWORD、CVC_CREDENTIAL_MASTER_KEY 等）。
- 安全：容器内以非 root 用户 pwuser 运行，禁用沙箱（加载模型生成的 HTML 需无沙箱）。
- 依赖补丁：通过 pnpm.patches 对 @earendil-works/pi-ai 应用本地 patch 文件。
- 构建上下文：Docker 构建必须在仓库根目录执行，以确保 pnpm workspace 解析正确。

### 5. 开发与验证脚本
- scripts/dev/start-dev.ps1：PowerShell 脚本统一启停 dev 服务（Next + worker + DB）。
- scripts/setup/：包含数据库初始化、凭据引导、演示账号种子等一次性脚本。
- scripts/verify/：架构基线验证、端到端冒烟测试、托管服务就绪检查等。
- patches/@earendil-works__pi-ai.patch：对第三方包的本地修改。

### 6. 未发现的 CI/CD
仓库中未发现 GitHub Actions、GitLab CI 或其他持续集成配置文件，构建与发布流程可能由外部系统或手动触发。