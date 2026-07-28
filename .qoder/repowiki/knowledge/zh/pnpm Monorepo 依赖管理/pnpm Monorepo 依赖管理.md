---
kind: dependency_management
name: pnpm Monorepo 依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - server/package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - .dockerignore
    - Dockerfile
    - server/Dockerfile
    - scripts/dev/start-dev.ps1
---

本项目采用 pnpm workspace 管理的 monorepo 结构，通过单一 `package.json` + `pnpm-lock.yaml` 锁定全仓库依赖版本，并配合 Docker 构建确保环境一致性。

**系统/工具链**
- 包管理器：pnpm（`packageManager: "pnpm@10.30.0"` 强制版本）
- Node 引擎要求：`engines.node >= 22.11.0`
- 锁文件：根级 `pnpm-lock.yaml`（lockfileVersion 9.0），所有安装必须使用 `--frozen-lockfile`
- 工作区：`pnpm-workspace.yaml` 声明两个 package：`.`（Next.js 前端）和 `server`（独立 Node 渲染服务）
- 构建容器：Dockerfile 在 Linux 镜像内执行 `pnpm install --frozen-lockfile`，禁止从宿主机拷贝 `node_modules`

**关键文件与职责**
- `package.json`（根）：定义 Next.js 应用依赖、脚本（dev/build/test/lint/typecheck）、`pnpm.onlyBuiltDependencies` 白名单（esbuild、ffmpeg-static、sharp）
- `server/package.json`：独立 Node 服务依赖（imapflow、mailparser、playwright、sharp、zod），与前端解耦
- `pnpm-lock.yaml`：精确锁定所有依赖及其子依赖的解析结果，包含 importers 分段记录每个 workspace 的依赖树
- `.dockerignore`：排除 node_modules，强制镜像内安装
- `scripts/dev/start-dev.ps1`：开发启动脚本，检测 pnpm 版本差异、lockfile 新旧比较，自动触发 `pnpm install`

**架构与约定**
- Monorepo 双包结构：前端（Next.js App Router）与后端（Node 渲染服务）各自维护独立 `package.json`，共享同一份 lockfile
- 依赖版本策略：生产依赖使用 `^` 语义化版本（如 `next ^16.2.0`、`react 19.2.x`），内部私有包 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai` 使用精确版本号 `0.80.10`
- 原生模块优化：通过 `pnpm.onlyBuiltDependencies` 仅允许 esbuild、ffmpeg-static、sharp 编译原生扩展，减少构建体积
- 浏览器依赖隔离：server 端使用 Playwright 进行页面采集，但 Dockerfile 注释说明跳过浏览器下载，运行期按需获取 Chromium
- 数据库驱动分离：postgres 客户端作为运行时依赖引入，drizzle-kit 作为 devDependency 用于迁移生成

**约束与规则**
- 构建阶段必须使用 `pnpm install --frozen-lockfile`，禁止修改 lockfile 或跳过安装
- Windows 开发时若 pnpm 版本与 `packageManager` 字段不一致会发出警告
- 禁止从宿主机复制 `node_modules` 到容器镜像，必须在 Linux 环境中重新安装
- 原生模块安装仅限白名单中的三个包，其他含原生扩展的依赖需额外审批
- 私有包 `@earendil-works/*` 需要对应的 npm registry 配置（当前未在项目中发现 .npmrc 或私有源配置）