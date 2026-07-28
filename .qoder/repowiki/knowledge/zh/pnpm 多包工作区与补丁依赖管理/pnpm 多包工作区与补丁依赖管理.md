---
kind: dependency_management
name: pnpm 多包工作区与补丁依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - server/package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - patches/@earendil-works__pi-ai.patch
---

本仓库使用 pnpm 作为统一的包管理器，采用多包工作区（workspace）模式组织前端 Next.js 应用与独立 Node.js 后端服务，并通过 lockfile 和 patch 机制确保依赖版本一致性与可重现构建。

**系统/工具链**
- 包管理器：pnpm@10.30.0（通过 `packageManager` 字段锁定版本）
- 工作区：`pnpm-workspace.yaml` 声明根目录 `.` 与 `server` 两个包
- Lockfile：`pnpm-lock.yaml`（lockfileVersion 9.0），记录所有依赖精确版本、完整性校验及 patchedDependencies
- Node 引擎要求：`engines.node >= 22.11.0`

**关键文件与结构**
- 根 `package.json`：定义 Next.js 前端依赖（react 19.2.x、next 16.2.x、zod 4.4.3、openai 等）与开发工具（vitest、eslint、prettier、drizzle-kit）
- `server/package.json`：独立后端包，依赖 imapflow、mailparser、playwright、sharp、zod
- `pnpm-workspace.yaml`：声明 workspace 包含 `.` 和 `server`
- `pnpm-lock.yaml`：完整锁文件，含 `patchedDependencies` 段记录对 `@earendil-works/pi-ai` 的补丁哈希
- `patches/@earendil-works__pi-ai.patch`：对第三方包的本地补丁，修改错误处理与 fetch 回调逻辑

**架构与约定**
- 前后端分离：Next.js 前端与 server 子包各自维护独立的 `package.json`，共享 pnpm workspace 进行统一安装
- 依赖版本策略：生产依赖使用语义化版本范围（如 `^16.2.0`、`^4.4.3`），部分关键依赖使用精确版本（如 `postgres: 3.4.9`、`nodemailer: 9.0.3`）
- 构建优化：通过 `pnpm.onlyBuiltDependencies` 仅允许 esbuild、ffmpeg-static、sharp 三个包执行原生构建，减少安装开销
- 补丁管理：通过 `pnpm.patchedDependencies` 将 `@earendil-works/pi-ai` 的补丁映射到 `patches/` 目录下的 diff 文件，确保补丁在 CI 中可重现应用
- 测试隔离：提供 `vitest.pg.config.ts` 用于 PostgreSQL 集成测试，与主测试配置分离

**约束与规则**
- 必须使用 pnpm 作为包管理器（由 `packageManager` 字段强制）
- Node.js 版本必须 ≥ 22.11.0（由 `engines` 字段声明）
- 仅允许 esbuild、ffmpeg-static、sharp 执行原生构建（由 `onlyBuiltDependencies` 限制）
- 第三方包补丁必须放在 `patches/` 目录并通过 `pnpm-workspace` 的 `patchedDependencies` 注册
- 工作区内的包通过相对路径引用，不发布到 npm registry（两个包均标记为 `private: true`）