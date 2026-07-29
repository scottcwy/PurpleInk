---
kind: dependency_management
name: pnpm 多包工作区与补丁依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - server/package.json
    - patches/@earendil-works__pi-ai.patch
    - Dockerfile
    - server/Dockerfile
---

本项目采用 pnpm 作为包管理器，通过 pnpm-workspace.yaml 定义双包工作区（根模块 `ai-saas` 与独立后端服务 `purpleink-server`），并使用 pnpm-lock.yaml 锁定依赖版本。核心特征如下：

**包管理器与工作区结构**
- 根 `package.json` 声明 `packageManager: "pnpm@10.30.0"` 和 `engines.node: ">=22.11.0"`，强制统一环境。
- `pnpm-workspace.yaml` 将 `.` 与 `server` 纳入同一工作区，共享锁文件 `pnpm-lock.yaml`。
- 根脚本通过 `pnpm --filter purpleink-server dev` 启动子包，实现前后端并行开发。

**依赖声明与版本策略**
- 生产依赖集中在根 `package.json` 的 `dependencies` 中（Next.js、React、Playwright、OpenAI、Zod 等），子包 `server/package.json` 仅声明服务端特有依赖（imapflow、mailparser、sharp）。
- 开发依赖（eslint、prettier、vitest、tsconfig 等）全部放在根 `devDependencies`，避免重复安装。
- 关键依赖使用精确或较窄范围（如 `next: ^16.2.0`、`react: 19.2.x`、`postgres: 3.4.9`），配合 lockfile 保证可重现构建。

**原生依赖优化**
- 通过 `pnpm.onlyBuiltDependencies` 白名单限制 `esbuild`、`ffmpeg-static`、`sharp` 三个需要编译的原生包，减少无关依赖的安装体积。

**补丁机制（patchedDependencies）**
- 项目对第三方包 `@earendil-works/pi-ai` 应用了自定义补丁，位于 `patches/@earendil-works__pi-ai.patch`。
- 补丁修改了 OpenAI 流式响应的错误处理逻辑，增加 `onResponse` 回调以捕获 HTTP 状态码，并将错误消息规范化为稳定的 HTTP 类别（如 `HTTP 4xx/5xx`），避免泄露 provider 响应体到持久化表面。
- 该补丁通过 `pnpm.patchedDependencies` 字段注册，在 `pnpm install` 时自动应用。

**容器化与依赖缓存**
- Dockerfile 分阶段构建：先 COPY `pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml` 执行 `pnpm install --frozen-lockfile` 缓存依赖层，再 COPY 源码，确保依赖变更时才重新安装。
- 文档明确说明此策略用于加速 CI 构建。

**私有仓库与认证**
- 未发现 `.npmrc`、`.pnpmrc` 或 `registry` 配置，表明未使用私有 npm registry；依赖从官方 npm 源拉取。
- 环境变量通过 `.env.example` 和 `server/.env.example` 管理，不包含 registry 相关配置。

**约束与约定**
- Lockfile 必须提交至版本控制（Dockerfile 使用 `--frozen-lockfile` 强制校验）。
- 新增依赖需更新 `package.json` 并运行 `pnpm install` 生成新的 lockfile。
- 原生依赖必须加入 `onlyBuiltDependencies` 白名单，避免意外安装编译型包。