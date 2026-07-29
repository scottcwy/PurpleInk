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
    - pnpm-lock.yaml
---

本项目采用 pnpm 作为包管理器，通过 workspace 模式管理 Next.js 前端与独立渲染 Worker（purpleink-server）两个子包，所有第三方依赖通过 pnpm-lock.yaml 锁定版本，确保构建可重现。

**系统/工具**
- 包管理器：pnpm@10.30.0（由 package.json 的 `packageManager` 字段强制指定）
- Node 引擎要求：>=22.11.0（engines 字段约束）
- 工作区：pnpm-workspace.yaml 声明根目录和 server 子包
- 锁文件：pnpm-lock.yaml 提交到版本控制

**关键文件与结构**
- 根 package.json：定义 Next.js 应用依赖（next、react、drizzle-orm、openai、playwright 等）及开发工具链（eslint、prettier、vitest、tsx）
- server/package.json：独立渲染 Worker 依赖（imapflow、mailparser、sharp、zod、playwright），与前端解耦
- pnpm-workspace.yaml：声明 packages: [".", "server"]
- patches/@earendil-works__pi-ai.patch：对私有包 @earendil-works/pi-ai 的本地补丁，通过 pnpm.patchedDependencies 映射生效

**架构与约定**
- 双包分离：前端（Next.js App Router）与后端渲染 Worker 各自维护独立 package.json，避免依赖膨胀
- 共享依赖通过 workspace 解析，减少重复安装
- 仅构建依赖：pnpm.onlyBuiltDependencies 限定 esbuild、ffmpeg-static、sharp 三个需要原生编译的包，加速安装
- 私有包补丁：针对 @earendil-works/pi-ai 的 OpenAI SDK 错误处理进行安全加固（过滤 provider 响应体中的敏感元数据，仅保留 HTTP 状态码用于重试策略）
- 脚本约定：dev/dev:worker/dev:all 统一通过 pnpm scripts 启动，支持 Windows PowerShell 脚本

**约束与规则**
- 必须使用 pnpm@10.30.0（packageManager 字段由 pnpm 自动校验）
- Node 版本必须 >=22.11.0（engines 字段）
- 所有依赖版本由 pnpm-lock.yaml 锁定，禁止手动修改 node_modules
- 仅允许对 @earendil-works/pi-ai 打补丁，其他依赖不得直接修改
- server 子包独立于前端，通过 /api 反向代理通信，不共享依赖树