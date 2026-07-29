---
kind: dependency_management
name: PNPM 多包工作区与依赖锁定策略
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - server/package.json
    - patches/@earendil-works__pi-ai.patch
    - Dockerfile
---

本项目采用 **pnpm 10.30.0** 作为包管理器，基于 `pnpm-workspace.yaml` 管理根项目与 `server/` 子包的 **双包工作区**。依赖版本通过 `package.json` 声明，并由 `pnpm-lock.yaml` 锁定，构建时使用 `--frozen-lockfile` 确保可重复安装。Node.js 引擎版本通过 `engines.node >= 22.11.0` 强制约束，并通过 `packageManager` 字段固定 pnpm 版本。

**关键文件与结构：**
- 根 `package.json`：定义 Next.js、React、OpenAI、Playwright、Drizzle ORM 等核心依赖及开发工具链（ESLint、Prettier、Vitest、TypeScript）。
- `server/package.json`：后端服务独立声明依赖（imapflow、mailparser、sharp、zod），与前端共享 pnpm workspace。
- `pnpm-workspace.yaml`：声明 `.` 和 `server` 两个 workspace 包。
- `patches/@earendil-works__pi-ai.patch`：通过 `pnpm patchedDependencies` 对第三方包 `@earendil-works/pi-ai` 进行补丁修复，修改错误处理逻辑以安全持久化流式错误事件。

**构建与部署中的依赖管理约定：**
- Dockerfile 分三阶段（deps → build → runtime），在 deps 阶段仅 COPY `pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml` 和 `server/package.json` 后执行 `pnpm install --frozen-lockfile`，确保依赖缓存命中且版本锁定。
- `onlyBuiltDependencies` 白名单限制 `esbuild`、`ffmpeg-static`、`sharp` 三个需要原生编译的包，减少安装体积。
- Playwright 浏览器二进制通过 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 在构建期跳过，运行时按 `node_modules/playwright/package.json` 中实际版本动态安装，保证宿主与容器内 Chromium 版本一致。
- `.prettierignore` 显式忽略 `pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`，避免格式化工具误触锁文件。

**私有依赖与补丁策略：**
- 内部包 `@earendil-works/pi-ai` 通过 npm registry 引入并打补丁，补丁文件位于 `patches/` 目录，由 pnpm 自动应用。
- 未使用 vendoring（无 `vendor/` 或 `node_modules` 提交），所有依赖均从远程 registry 安装。
- 环境变量与密钥通过 `.env.example` 模板 + `config/tts.env.example` 管理，不硬编码于依赖配置中。

**约束与规范：**
- 禁止引入 `@openai/agents*` 包（见 docs/issues/README.md 零容忍规则）。
- 依赖变更必须通过 `pnpm add` 更新 `package.json`，由 pnpm 自动生成 `pnpm-lock.yaml`，禁止手动编辑锁文件。
- CI/CD 与本地开发脚本（`scripts/dev/start-dev.ps1`）检测 `pnpm-lock.yaml` 时间戳决定是否重新安装，确保依赖一致性。