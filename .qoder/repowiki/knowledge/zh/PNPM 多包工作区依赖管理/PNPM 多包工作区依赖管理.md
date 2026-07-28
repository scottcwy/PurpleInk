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

本项目采用 **pnpm** 作为包管理器，通过 **pnpm-workspace** 组织双进程架构（Next.js 前端 + 独立 Node.js 渲染 Worker）的依赖管理。

**系统与方法**
- 包管理器：pnpm@10.30.0（由 `packageManager` 字段锁定），使用 pnpm-lock.yaml v9.0 锁文件确保可重复安装
- 工作区配置：`pnpm-workspace.yaml` 声明根目录 `.` 和 `server` 两个包，共享依赖解析
- 无 vendoring：未使用 node_modules 本地打包或私有仓库镜像，直接依赖 npm 公共注册表

**关键文件与职责**
- 根 `package.json`：定义 Next.js 应用依赖（react、next、drizzle-orm、openai、playwright 等）及开发工具链（vitest、eslint、prettier、tailwindcss）
- `server/package.json`：独立后端服务依赖（imapflow、mailparser、sharp、zod），与前端解耦
- `pnpm-lock.yaml`：完整锁定所有依赖树版本与 integrity hash
- `.dockerignore` / `Dockerfile`：构建时不包含 node_modules，通过 `pnpm install --frozen-lockfile` 生成

**架构与约定**
- 双包分离：前端（Next.js）与后端（Node/tsx）各自维护独立依赖，避免运行时污染
- 严格版本策略：核心库使用精确版本（如 `react: 19.2.x`、`postgres: 3.4.9`、`nodemailer: 9.0.3`），生态库使用语义化范围（`^` 前缀）
- 构建优化：`pnpm.onlyBuiltDependencies` 仅允许 esbuild、ffmpeg-static、sharp 执行原生构建，减少 Docker 镜像体积
- Node 引擎约束：`engines.node >= 22.11.0` 强制运行环境一致性

**约束与规范**
- 依赖更新需同步提交 pnpm-lock.yaml，保证 CI/CD 可重现
- 私有包 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai` 使用固定版本号 0.80.10，表明内部包采用精确版本发布策略
- 测试与验证脚本（scripts/verify/*）在依赖变更后需重新运行，确保架构契约不变