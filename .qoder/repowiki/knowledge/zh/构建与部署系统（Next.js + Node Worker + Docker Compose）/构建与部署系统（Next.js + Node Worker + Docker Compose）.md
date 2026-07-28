---
kind: build_system
name: 构建与部署系统（Next.js + Node Worker + Docker Compose）
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
    - pnpm-workspace.yaml
    - scripts/dev/start-dev.ps1
---

## 构建系统与工具链

本项目采用 **pnpm monorepo** 管理依赖，使用 **Next.js 16** 作为前端应用框架，配合独立的 **Node.js worker 服务**（server/）提供渲染队列、浏览器采集与 TTS 合成能力。构建与部署围绕 Docker 多阶段镜像和 docker-compose 编排展开。

### 核心构建流程
- **包管理器**: pnpm@10.30.0（通过 corepack 启用），锁定文件 `pnpm-lock.yaml` + `pnpm-workspace.yaml`
- **TypeScript 编译**: 直接由 Next.js 内置编译器处理，开发期用 `tsx watch` 热重载
- **测试框架**: Vitest（`vitest run`），PostgreSQL 集成测试通过独立配置 `vitest.pg.config.ts`
- **代码质量**: ESLint 9 + Prettier 3，脚本入口在根 `package.json` 的 scripts 中

### 多阶段 Docker 构建
项目定义了两套独立但共享 workspace 依赖的 Dockerfile：

1. **根 Dockerfile**（Next.js 应用）: 4 个阶段（deps → build → migrate → runtime），生产镜像基于 `node:22-bookworm-slim`，包含 Playwright Chromium 运行时、CJK 字体（fonts-wqy-zenhei）、非 root 用户 pwuser
2. **server/Dockerfile**（Worker 服务）: 2 个阶段（deps → runtime），直接以 tsx 运行 TypeScript 源码，暴露 8787 端口
3. **deploy/reverse-proxy/Dockerfile**: 基于 caddy:2.10-alpine 作为反向代理，仅 8 行

### 容器编排策略
- **开发环境** (`docker-compose.dev.yml`): 仅启动 PostgreSQL 数据库，Next.js 与 worker 通过本地 pnpm 脚本启动
- **生产环境** (`docker-compose.prod.yml`): 完整 7 服务编排
  - `reverse-proxy`: Caddy 反向代理，唯一对外暴露 443 端口，支持 TLS + IP 白名单 + Basic Auth
  - `next`: Next.js 应用，固定 replicas=1（进程内状态机不支持多实例）
  - `worker`: 渲染/采集 worker，通过 BACKEND_ORIGIN 被 next 内网访问
  - `postgres`: PostgreSQL 17.5，持久化卷存储
  - `migrate`: 一次性数据库迁移任务
  - `bootstrap-credentials`: 凭据初始化（从 env 校验后写入加密 DB）
  - `seed-demo-account`: 演示账号种子数据（可选）

### 关键构建约束与约定
- **Playwright 浏览器安装**: 构建期跳过下载（`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`），运行期按实际安装的 playwright 版本动态安装 Chromium
- **字体选择**: 使用 fonts-wqy-zenhei（7.5MB）替代 fonts-noto-cjk（60.2MB），避免构建网络超时失败
- **非 root 运行**: 所有容器均以 pwuser 用户运行，Chromium 二进制存放在 /ms-playwright
- **环境变量注入**: 生产环境通过 docker-compose secrets 和 .env 变量注入，敏感信息不硬编码
- **健康检查**: next 服务通过 `/api/ping` 端点，worker 通过 `/health` 端点进行健康探测
- **并发控制**: 必须显式设置 `CVC_QUEUE_RENDER_SHOT_CONCURRENCY` 和 `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY`，避免按宿主 CPU 核数导致 OOM

### 开发与调试脚本
- `scripts/dev/start-dev.ps1`: PowerShell 脚本同时启动 Next.js 和 worker，支持 `-Status` 和 `-Stop` 参数
- `pnpm dev:all`: 一键启动全栈开发环境
- `pnpm verify:v3` / `verify:e2e`: 架构验证与 E2E 冒烟测试
- `pnpm db:migrate`: 使用 drizzle-kit 执行数据库迁移

### 发布产物
- Next.js 构建产物输出到 `.next/` 目录
- Worker 服务无单独构建物，直接运行 TypeScript 源码
- 所有依赖通过 pnpm workspace 统一管理，确保 Next.js 与 server 模块间依赖版本一致