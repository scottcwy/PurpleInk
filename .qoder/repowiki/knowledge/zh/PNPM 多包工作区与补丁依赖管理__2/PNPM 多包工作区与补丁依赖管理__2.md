---
kind: dependency_management
name: pnpm 多包工作区与补丁依赖管理
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

本项目采用 pnpm 作为统一的依赖管理工具，通过 pnpm-workspace.yaml 将根目录（Next.js 前端）与 server/（独立渲染 Worker）组织为双包工作区。所有依赖声明集中在两个 package.json 中：根 package.json 定义 Next.js、React、AI SDK、Playwright、Drizzle ORM 等运行时与开发依赖；server/package.json 仅声明 imapflow、mailparser、sharp、zod 等服务端专用依赖。pnpm-lock.yaml 锁定所有包的精确版本与完整性校验，确保构建可重现。

项目对第三方依赖的定制通过 pnpm patches 机制实现：在 patches/@earendil-works__pi-ai.patch 中对 @earendil-works/pi-ai 进行源码级修改（重写错误处理逻辑、注入 onResponse 回调以捕获非 2xx 响应状态），并在根 package.json 的 pnpm.patchedDependencies 字段中声明该补丁映射。pnpm-lock.yaml 同时记录 patch_hash 以确保补丁一致性。

构建优化方面，根 package.json 的 pnpm.onlyBuiltDependencies 显式声明 esbuild、ffmpeg-static、sharp 为唯一允许编译原生模块的依赖，减少安装时的构建开销。Node 引擎版本通过 engines.node >=22.11.0 强制约束，packageManager 字段固定 pnpm@10.30.0 保证团队环境一致。

私有依赖方面，@earendil-works/pi-agent-core 与 @earendil-works/pi-ai 使用内部作用域包名，但未在仓库中发现 .npmrc 或 pnpm 私有 registry 配置，推测通过全局 pnpm 配置或 CI 环境变量注入 registry 地址。依赖更新策略采用混合模式：核心框架（next、react、playwright）使用较宽松的 ^ 前缀，而关键库如 nodemailer、postgres 则锁定精确版本以避免破坏性变更。

脚本层面，dev:worker 通过 pnpm --filter purpleink-server dev 启动独立服务，scripts/dev/start-dev.ps1 提供 Windows 下前后端并行启动能力，形成完整的双进程开发体验。