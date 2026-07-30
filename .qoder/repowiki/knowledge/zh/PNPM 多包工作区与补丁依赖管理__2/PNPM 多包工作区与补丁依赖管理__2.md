---
kind: dependency_management
name: PNPM 多包工作区与补丁依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - server/package.json
    - patches/@earendil-works__pi-ai.patch
---

本仓库采用 pnpm 作为包管理器，通过 pnpm-workspace.yaml 定义双包工作区（根 Next.js 应用 `ai-saas` 与独立 Node 渲染服务 `purpleink-server`），并使用 pnpm-lock.yaml 锁定所有依赖版本。Node 版本通过 engines 字段强制要求 >=22.11.0，packageManager 字段固定 pnpm@10.30.0，确保构建环境一致。

依赖声明集中在两个 package.json：根 package.json 管理前端依赖（Next.js、React、Tailwind、Zod、Playwright 等）及开发工具链；server/package.json 仅声明服务端运行时依赖（imapflow、mailparser、sharp、zod 等），保持前后端依赖隔离。

针对第三方包 `@earendil-works/pi-ai` 的定制修改通过 pnpm patch 机制实现，补丁文件位于 patches/@earendil-works__pi-ai.patch，在 package.json 的 pnpm.patchedDependencies 中注册。该补丁修改了 OpenAI 兼容接口的错误处理逻辑，将 provider 响应体中的敏感元数据剥离，仅保留 HTTP 状态码用于重试策略，避免将外部响应内容持久化到可重试记录中。

构建优化方面，pnpm.onlyBuiltDependencies 显式声明 esbuild、ffmpeg-static、sharp 为仅构建期依赖，减少生产镜像体积。未使用私有 npm registry、NPM_TOKEN 或 .npmrc 配置，也未见 vendoring 策略（node_modules 未被提交）。