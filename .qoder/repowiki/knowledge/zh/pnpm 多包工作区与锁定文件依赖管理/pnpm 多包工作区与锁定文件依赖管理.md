---
kind: dependency_management
name: pnpm 多包工作区与锁定文件依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - server/package.json
---

本仓库使用 pnpm 作为包管理器，采用多包工作区（workspace）模式管理 Next.js 前端与独立渲染 Worker（purpleink-server）两个子包的依赖。核心机制如下：

1. **包管理器与工作区**
   - 根 `package.json` 声明 `packageManager: "pnpm@10.30.0"` 和 `engines.node >= 22.11.0`，固定 Node 版本。
   - `pnpm-workspace.yaml` 定义两个包：根包（Next.js 应用）与 `server/`（独立后端服务），通过 `pnpm --filter purpleink-server dev` 等脚本在 workspace 内切换。
   - 根 `pnpm-lock.yaml`（lockfileVersion 9.0）为整个 workspace 生成单一锁定文件，确保所有子包依赖树一致可重现。

2. **依赖声明与版本策略**
   - 根包 `dependencies` 包含 Next.js、React 19、Playwright、OpenAI SDK、Drizzle ORM、Zod 等运行时依赖；`devDependencies` 包含 TypeScript、Vitest、ESLint、Prettier、Tailwind 等开发工具。
   - server 包仅声明最小运行时依赖（imapflow、mailparser、playwright、sharp、zod），保持 worker 进程轻量。
   - 版本策略混合使用精确版本（如 `next: ^16.2.0`、`react: 19.2.x`）与语义化范围，关键内部包 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai` 固定到 `0.80.10`。

3. **构建优化与原生模块**
   - 根 `package.json` 的 `pnpm.onlyBuiltDependencies` 显式声明 `esbuild`、`ffmpeg-static`、`sharp` 为仅构建期依赖，减少生产镜像体积。
   - server 包中 sharp 作为运行时依赖用于图像裁剪，playwright 用于浏览器采集。

4. **私有注册表与认证**
   - 未发现 `.npmrc`、`.pnpmrc` 或环境变量中的私有注册表配置（如 `registry=`、`NPM_TOKEN`、`PNPM_REGISTRY`），表明当前未配置企业私有 npm 源。
   - 内部包 `@earendil-works/*` 可能来自公共 registry 或 CI 环境注入的认证，但代码库中无相关配置可见。

5. **依赖更新与验证**
   - 通过 `pnpm test`、`pnpm typecheck`、`pnpm verify:v3` 等脚本验证依赖兼容性。
   - `pnpm-lock.yaml` 提交至版本控制，确保团队与 CI 环境安装完全一致的依赖树。

约束与约定：
- 所有依赖必须通过 pnpm 安装，禁止直接操作 node_modules。
- 新增依赖需同时更新 `pnpm-lock.yaml` 并提交。
- 原生模块需在 `onlyBuiltDependencies` 中显式声明以优化 Docker 镜像大小。
- 前后端共享依赖（如 zod、typescript）通过 workspace hoisting 统一管理版本。