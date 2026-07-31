---
kind: dependency_management
name: pnpm 工作区依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - server/package.json
    - packages/procedural-sfx/package.json
    - patches/@earendil-works__pi-ai.patch
---

本项目采用 pnpm workspace 作为统一的依赖管理系统，通过单仓多包（monorepo）结构组织 Next.js Web 应用、Node 服务端渲染服务与程序化音效库，所有第三方依赖声明集中在各包的 package.json 中，并由根级 pnpm-lock.yaml 锁定版本。

**系统与方法**
- 包管理器：pnpm@10.30.0（通过 packageManager 字段强制），使用 lockfileVersion 9.0 的 pnpm-lock.yaml 作为唯一可信源
- 工作区配置：pnpm-workspace.yaml 声明三个包路径：根目录（Next.js Web）、server（后端服务）、packages/*（内部库）
- Node 版本约束：engines.node >= 22.11.0，确保运行时一致性

**关键文件与包**
- 根 package.json：定义 Web 应用依赖（next 16.2.x、react 19.2.x、zod 4.4.3、openai 等）及开发工具链（vitest、eslint、prettier、tsx）
- server/package.json：后端服务依赖（imapflow、mailparser、sharp、playwright、zod），通过 workspace:* 引用 @purpleink/procedural-sfx
- packages/procedural-sfx/package.json：内部库，仅声明 vitest 和 typescript 为 devDependencies，无运行时依赖
- pnpm-lock.yaml：完整锁定所有依赖树，包含 patchedDependencies 映射

**架构与约定**
- 工作区内包通过 workspace:* 协议互相引用，避免重复安装，实现零拷贝链接
- 构建优化：pnpm.onlyBuiltDependencies 仅允许 esbuild、ffmpeg-static、sharp 执行原生构建，减少 CI 构建时间
- 补丁机制：通过 pnpm.patchedDependencies 对 @earendil-works/pi-ai 进行精确修补，patch 文件存放于 patches/ 目录，lockfile 中记录 patch hash 保证可重现性
- 依赖版本策略：核心依赖使用精确版本（如 next 16.2.0、react 19.2.x），生态依赖使用语义化范围（如 zod ^4.4.3、playwright ^1.61.1）

**约定与约束**
- 所有包必须遵循 pnpm workspace 协议，禁止在子包中创建独立的 node_modules
- 新增依赖需同时更新 pnpm-lock.yaml，确保锁文件与工作区状态一致
- 原生模块构建需显式列入 onlyBuiltDependencies，否则安装失败
- 内部库通过 workspace:* 引用，禁止发布到 npm registry
- 第三方补丁必须通过 pnpm patch 命令生成并纳入版本控制，禁止直接修改 node_modules