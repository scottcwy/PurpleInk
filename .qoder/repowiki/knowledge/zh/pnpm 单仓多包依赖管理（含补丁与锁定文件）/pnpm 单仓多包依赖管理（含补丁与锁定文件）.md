---
kind: dependency_management
name: pnpm 单仓多包依赖管理（含补丁与锁定文件）
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

本项目采用 pnpm 作为统一的依赖管理工具，通过单仓库多包（monorepo）结构组织前端 Next.js 应用与独立渲染 Worker（server/），并使用 pnpm-lock.yaml 锁定所有依赖版本，确保构建可重现。

- 包管理器与引擎约束：根 package.json 声明 `packageManager: "pnpm@10.30.0"` 与 `engines.node: ">=22.11.0"`，强制团队与 CI 使用指定版本的 pnpm 和 Node.js。
- 工作区配置：pnpm-workspace.yaml 将根目录与 server/ 两个包纳入同一工作区，共享 pnpm 的依赖解析与安装策略。
- 依赖声明位置：
  - 根包（ai-saas）：Next.js、React、Tailwind、Zod、OpenAI SDK、Playwright、Drizzle ORM 等运行时与开发依赖集中在根 package.json 的 dependencies/devDependencies。
  - server 包（purpleink-server）：仅包含采集与渲染所需的 imapflow、mailparser、playwright、sharp、zod 等依赖，保持最小化。
- 锁定文件：pnpm-lock.yaml 记录每个包的精确版本、完整性校验（integrity）以及 peerDependencies 解析结果，是构建可重现性的核心。
- 补丁机制：通过 pnpm 的 `patchedDependencies` 字段对私有包 `@earendil-works/pi-ai` 打补丁，补丁文件位于 patches/@earendil-works__pi-ai.patch，用于修复上游行为（如错误消息脱敏、fetch 回调注入）。
- 原生依赖优化：在 pnpm.onlyBuiltDependencies 中显式声明 esbuild、ffmpeg-static、sharp，避免不必要的原生模块重建，提升安装与构建性能。
- 无 vendoring：项目未使用 node_modules 提交或 vendor 目录，依赖由 pnpm 从 npm registry 解析并缓存到本地 store。
- 私有注册表：未发现 .npmrc、.pnpmrc 或环境变量中配置的私有 registry/GOPRIVATE 设置，依赖均从公共 npm 源获取。
- 脚本约定：根 scripts 提供 dev/build/lint/test/typecheck/db:migrate 等统一入口，server 包也有独立的 dev/start/capture/render 脚本，便于分别启动前后端。