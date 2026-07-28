---
kind: dependency_management
name: pnpm 工作区依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - server/package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
---

本项目采用 **pnpm workspace** 作为统一的依赖管理系统，聚合 Next.js 前端与 server/Worker 两个子包，通过锁文件锁定所有依赖版本，确保构建可重复性。

### 系统与工具
- **包管理器**: pnpm（指定版本 `pnpm@10.30.0`，通过 `packageManager` 字段强制）
- **Node 引擎要求**: `>=22.11.0`（通过 `engines` 字段声明）
- **工作区配置**: `pnpm-workspace.yaml` 声明根目录 `.` 和 `server` 两个包
- **锁文件**: `pnpm-lock.yaml`（lockfileVersion 9.0），记录精确解析后的依赖树与 integrity hash

### 关键文件与职责
- `package.json`（根）：定义 Next.js 应用依赖、开发脚本（dev/build/test/lint/typecheck）、`onlyBuiltDependencies` 白名单（esbuild、ffmpeg-static、sharp）
- `server/package.json`：后端 Worker 包，依赖 imapflow、mailparser、playwright、sharp、zod 等
- `pnpm-workspace.yaml`：声明工作区成员
- `pnpm-lock.yaml`：完整依赖锁定，包含 importers（根与 server）及 packages 段中每个包的 resolution integrity

### 架构与约定
- **双包结构**：根包负责前端 Next.js 应用，server 包独立运行 Node 服务，两者通过 pnpm workspace 共享依赖解析
- **版本策略**：核心依赖使用语义化版本范围（如 `^16.2.0`、`^4.4.3`），部分关键包使用精确版本（如 `next: ^16.2.0`、`postgres: 3.4.9`、`nodemailer: 9.0.3`）
- **原生依赖优化**：通过 `pnpm.onlyBuiltDependencies` 仅允许 esbuild、ffmpeg-static、sharp 进行原生编译，减少安装体积与构建时间
- **无私有仓库配置**：未发现 `.npmrc`、`.pnpmrc` 或 registry 自定义配置，依赖均从 npm 官方源获取
- **无 vendoring**：未使用 `node_modules` 提交或 vendor 策略，依赖通过 pnpm 的硬链接机制在本地安装

### 约束与规范
- 所有依赖版本由 `pnpm-lock.yaml` 锁定，变更需更新锁文件以保证一致性
- Node 版本必须满足 `>=22.11.0`，由 `engines` 字段约束
- 原生模块仅限白名单内三个包，避免意外引入 C++ 扩展导致构建失败
- 工作区内的脚本通过 `pnpm --filter purpleink-server dev` 等方式跨包调用