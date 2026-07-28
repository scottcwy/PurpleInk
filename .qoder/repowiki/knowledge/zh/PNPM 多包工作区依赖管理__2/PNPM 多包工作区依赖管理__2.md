---
kind: dependency_management
name: PNPM 多包工作区依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - server/package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
---

本项目采用 pnpm 作为包管理器，通过 pnpm-workspace 实现多包（monorepo）依赖管理，包含根前端 Next.js 应用与独立的 server 渲染后端两个子包。

使用的系统与工具：
- 包管理器：pnpm@10.30.0（通过 packageManager 字段锁定版本）
- Node 版本要求：>=22.11.0（通过 engines 字段声明）
- 锁文件：pnpm-lock.yaml（lockfileVersion 9.0），提交到版本控制以保证构建可重现
- 工作区配置：pnpm-workspace.yaml 声明 . 和 server 两个包

关键文件与结构：
- 根 package.json：定义 Next.js 前端依赖（Next 16、React 19、Tailwind CSS v4、Zod v4、Drizzle ORM、Playwright、OpenAI SDK 等），以及开发脚本（dev/build/lint/test/typecheck）
- server/package.json：独立 Node 服务依赖（imapflow、mailparser、sharp、zod 等），使用 ESM 模式（type: module）
- pnpm-lock.yaml：完整依赖树锁定，包含所有包的精确版本与 integrity hash
- .dockerignore / Dockerfile：容器化时排除 node_modules，通过 pnpm install --frozen-lockfile 安装

架构与约定：
- 双包分离：前端（Next.js 应用）与后端（独立 Node 服务）各自维护 package.json，共享 pnpm 工作区但依赖不互相引用
- 私有包：使用 @earendil-works/pi-agent-core 和 @earendil-works/pi-ai 两个内部私有包，版本号固定为 0.80.10，表明存在私有 npm 仓库或 GitHub Packages
- 构建优化：通过 pnpm.onlyBuiltDependencies 仅允许 esbuild、ffmpeg-static、sharp 三个需要原生编译的包，减少构建体积
- 依赖版本策略：核心框架使用精确版本（如 next: ^16.2.0、react: 19.2.x），第三方库使用语义化版本范围（^ 前缀）

约束与规范：
- 锁文件必须提交：pnpm-lock.yaml 已纳入版本控制，CI/CD 应使用 --frozen-lockfile 确保依赖一致性
- Node 版本锁定：通过 .nvmrc 或 engines 字段强制 Node >= 22.11.0
- 原生依赖白名单：仅允许 esbuild、ffmpeg-static、sharp 进行原生编译，其他包不得包含 native modules
- 私有包访问：需配置 .npmrc 或环境变量（如 NPM_TOKEN）以访问 @earendil-works 命名空间下的私有包
- 脚本统一：根 package.json 提供 dev:worker、dev:all 等跨包脚本，通过 pnpm --filter 调用 server 包命令