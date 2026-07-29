---
kind: dependency_management
name: pnpm Workspace 多包依赖管理与补丁策略
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - server/package.json
    - patches/@earendil-works__pi-ai.patch
---

本项目采用 pnpm workspace 管理 Next.js 前端与 server/worker 两个子包的依赖，通过单一 lockfile 保证全仓库依赖一致性。

**系统与工具**
- 包管理器：pnpm@10.30.0（由 `packageManager` 字段锁定）
- 工作区：`pnpm-workspace.yaml` 声明根目录 `.` 与 `server` 两个包
- Lockfile：`pnpm-lock.yaml`（lockfileVersion 9.0），提交至版本控制
- Node 引擎要求：`>=22.11.0`

**包结构与依赖划分**
- 根包 `ai-saas`：Next.js 应用、UI 组件、业务逻辑，依赖 React 19.2.x、Next 16.2.x、Tailwind v4、Zod v4、Drizzle ORM、Playwright、OpenAI SDK 等
- 子包 `purpleink-server`：后端编排服务，依赖 imapflow、mailparser、sharp、zod、playwright，使用 ESM (`"type": "module"`) 并通过 tsx 运行
- 两包共享 Zod v4.4.3 作为运行时校验库，避免重复安装

**版本约束策略**
- 核心依赖使用精确版本或固定范围：如 `react: "19.2.x"`、`next: "^16.2.0"`、`postgres: "3.4.9"`、`nodemailer: "9.0.3"`
- 开发依赖使用较宽松范围：`eslint: ^9`、`prettier: ^3.7.4`、`vitest: ^4.1.10`
- 私有包 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai` 固定为 `0.80.10`，通过 npm registry 获取

**补丁机制**
- 使用 pnpm `patchedDependencies` 对 `@earendil-works/pi-ai` 应用 patch，文件位于 `patches/@earendil-works__pi-ai.patch`
- Patch 内容修改了 OpenAI 兼容流的错误处理，将 provider 响应体中的敏感元数据剥离，仅保留 HTTP 状态码用于重试策略，并新增 `onResponse` 回调以在 fetch 边界观察非 2xx 响应
- Lockfile 中记录 patch hash `febed32413daa9e13f9c2c3c367733aa0be201a3d05bc14e`，确保可重现

**构建优化**
- `pnpm.onlyBuiltDependencies` 仅允许 `esbuild`、`ffmpeg-static`、`sharp` 三个含原生模块的包执行构建脚本，减少 CI 构建时间与攻击面

**无 vendoring / 私有注册表**
- 未发现 `node_modules` 提交（除 `server/node_modules` 本地缓存外），未配置 `.npmrc` 或私有 registry
- 所有第三方依赖均从公共 npm registry 拉取，无 GOPRIVATE 或 Go module 代理配置