---
kind: build_system
name: 构建与制品管理（Next.js + Node Worker 多镜像 Docker 化）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - Dockerfile
    - server/Dockerfile
    - deploy/reverse-proxy/Dockerfile
    - docker-compose.prod.yml
    - docker-compose.dev.yml
    - next.config.ts
    - vitest.config.ts
    - scripts/dev/start-dev.ps1
---

本项目采用 **pnpm monorepo + Next.js App Router + 独立 Node 渲染 worker** 的架构，构建与制品管理围绕以下核心机制展开：

### 1. 包管理与脚本体系
- 根 `package.json` 定义统一脚本：`build`（next build）、`dev:all`（PowerShell 启动 dev 全栈）、`test`/`test:pg`（Vitest 单测/PostgreSQL 集成测试）、`db:migrate`（Drizzle 迁移）、`typecheck`（tsc --noEmit）等。
- 使用 `pnpm-workspace.yaml` 声明两个包：根（Next 前端）和 `server/`（Node worker），共享同一份 `pnpm-lock.yaml`。
- 通过 `engines.node >=22.11.0` 锁定运行时版本，`pnpm.patchedDependencies` 对 `@earendil-works/pi-ai` 应用本地 patch。
- 开发脚本集中在 `scripts/dev/start-dev.ps1`，提供 `dev:status`、`dev:stop` 等子命令。

### 2. 多阶段 Docker 构建
- **根 `Dockerfile`**（Next 应用）：分 `deps` → `build` → `migrate` → `runtime` 四阶段。生产镜像不启用 standalone，保留完整 node_modules 以兼容 tsx 迁移任务；Chromium 按实际 playwright 版本动态安装，非 root 用户 pwuser 运行。
- **`server/Dockerfile`**（worker）：同样 deps/runtime 两阶段，直接以 tsx 执行 TS 源码（无预编译产物），复用根 workspace 依赖解析结果。
- **`deploy/reverse-proxy/Dockerfile`**：基于 `caddy:2.10-alpine`，仅拷贝 Caddyfile 与 entrypoint。
- 两个 Dockerfile 均注释明确引用 ISSUE-015 与 PLAN-001 的对应章节，确保构建策略与设计文档一致。

### 3. 容器编排与服务依赖
- `docker-compose.prod.yml` 定义完整服务拓扑：`reverse-proxy`（Caddy，唯一对外 443 端口）→ `next`（Next 应用，replicas=1，因 stream-bus/status-bus 为进程内全局状态）→ `worker`（渲染后端，内网 8787）→ `postgres`。
- 一次性任务 `migrate`、`bootstrap-credentials`、`seed-demo-account` 作为 compose 服务在 next 之前完成，通过 `condition: service_completed_successfully` 强依赖。
- 所有敏感配置通过环境变量注入，生产强制要求设置强口令（`${POSTGRES_PASSWORD:?...}` 语法校验缺失）。
- `docker-compose.dev.yml` 仅提供 PostgreSQL 开发数据库，Next/worker 由 `pnpm dev:all` 本地启动。

### 4. Next.js 构建配置
- `next.config.ts` 中 `serverExternalPackages` 将 `ffmpeg-static`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core` 外部化，避免 Turbopack 破坏动态 require。
- `compiler.removeConsole` 在生产环境移除 console.log 但保留 error/warn，确保诊断信息可追溯。
- `rewrites` 将所有 `/api/engine/*` 转发至 `BACKEND_ORIGIN`（默认 `http://localhost:8787`），实现前后端同源部署。
- 支持 `CVC_NEXT_DIST_DIR` 环境变量指定独立构建目录，避免 dev server 与取证构建争用 `.next`。

### 5. 测试与验证流水线
- Vitest 配置分离普通测试与 PostgreSQL 测试（`vitest.pg.config.ts`），tests 目录存放跨模块集成测试。
- `scripts/verify/` 下包含架构基线检查（`v3-architecture.ts`）、托管服务就绪性检测（`managed-service-readiness.mjs`）、E2E 冒烟（`e2e-smoke.ts`）等验证脚本。
- Playwright 截图与视频证据保存在 `data/artifacts`、`.playwright-cli/` 目录，用于回归对比。

### 6. 关键约束与约定
- **禁止 Windows 宿主 COPY node_modules**：Docker 构建必须在 Linux 镜像内执行 pnpm install，否则 ffmpeg-static/postinstall 二进制不匹配。
- **Next 与 worker 是硬边界**：两者 env 加载器、model routing、job 状态机完全独立，不共享代码，仅共享 pnpm workspace 依赖解析。
- **Chromium 安装策略**：先 `install-deps` 装系统库，再以非 root 用户下载浏览器二进制到 `/ms-playwright`，避免沙箱风险。
- **字体选择**：放弃 60MB 的 fonts-noto-cjk，改用 7.5MB 的 fonts-wqy-zenhei，解决构建网络大文件下载失败问题。
- **单实例限制**：next 服务 replicas 固定为 1，因流式总线与状态总线依赖 globalThis 锚定，多实例会导致状态不一致。