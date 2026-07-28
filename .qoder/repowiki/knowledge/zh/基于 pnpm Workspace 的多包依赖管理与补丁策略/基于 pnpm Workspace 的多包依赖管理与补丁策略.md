---
kind: dependency_management
name: 基于 pnpm Workspace 的多包依赖管理与补丁策略
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

## 1. 使用的系统/方法
- **包管理器**：pnpm（通过 `packageManager` 字段锁定版本为 `pnpm@10.30.0`，Node 引擎要求 `>=22.11.0`）
- **工作区模式**：使用 `pnpm-workspace.yaml` 将根目录与 `server/` 子包纳入同一 workspace，实现单仓库多包管理
- **锁文件**：根级 `pnpm-lock.yaml` 作为唯一依赖快照，确保构建可重现
- **私有补丁**：通过 `pnpm.patchedDependencies` + `patches/` 目录对第三方包进行 diff 补丁（当前仅对 `@earendil-works/pi-ai` 打补丁）
- **原生依赖裁剪**：通过 `pnpm.onlyBuiltDependencies` 仅允许 `esbuild`、`ffmpeg-static`、`sharp` 三个包执行 native build，减少安装体积与安全风险

## 2. 关键文件与包
- `package.json`（根）：声明 Next.js 前端依赖、脚本命令、pnpm 配置、`packageManager` 与 `engines`
- `pnpm-workspace.yaml`：定义 workspace 包含 `.` 和 `server` 两个包
- `server/package.json`：独立渲染 Worker 包的依赖声明（playwright、sharp、imapflow、mailparser、zod 等）
- `patches/@earendil-works__pi-ai.patch`：对 `@earendil-works/pi-ai` 的源码级补丁，修改错误处理逻辑并注入 `onResponse` 回调以捕获 HTTP 状态码
- `pnpm-lock.yaml`：全局依赖锁定文件（未展示内容但由 pnpm 自动生成）
- `.dockerignore` / `Dockerfile`：容器化时仅 COPY `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`，保证缓存命中与依赖一致性

## 3. 架构与约定
- **前后端分离的双包结构**：根包负责 Next.js 应用与 UI 组件，`server/` 包作为独立的 Node/TS 渲染 Worker，两者通过 `/api` 反向代理通信
- **依赖共享策略**：workspace 模式下，若两包有共同依赖（如 `zod`、`playwright`），pnpm 会硬链接到公共 `node_modules/.pnpm`，避免重复安装
- **补丁优先于 fork**：对上游包的修改统一放在 `patches/` 目录，通过 `pnpm.patchedDependencies` 映射，便于追踪与撤销
- **严格的原生依赖白名单**：仅允许明确列出的三个包执行 native build，其余依赖默认跳过 build，提升安装速度与安全性
- **版本锁定策略**：所有依赖在 `package.json` 中使用语义化版本范围（如 `^4.4.3`、`^16.2.0`），具体解析结果由 `pnpm-lock.yaml` 固化

## 4. 约定与约束
- **必须使用指定版本的 pnpm**：`packageManager` 字段强制 `pnpm@10.30.0`，开发脚本会在版本不一致时告警（见 `scripts/dev/README.md`）
- **Node 版本下限**：`engines.node >= 22.11.0`，确保运行时环境一致
- **Workspace 包命名规范**：根包名为 `ai-saas`，服务端包名为 `purpleink-server`，均标记为 `private: true`，不发布到 npm
- **补丁文件命名约定**：`patches/<scope>__<pkg>.patch` 格式（如 `@earendil-works__pi-ai.patch`），与 `pnpm.patchedDependencies` 中的键名一一对应
- **容器构建最小化**：Dockerfile 中仅复制 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`，利用 pnpm 的缓存层优化构建速度
- **测试与验证脚本**：提供 `verify:v3`、`verify:managed-services`、`verify:e2e` 等脚本用于依赖与架构验证，确保依赖变更不会破坏契约

### 约束来源
- `package.json` 中的 `packageManager`、`engines`、`pnpm.patchedDependencies`、`pnpm.onlyBuiltDependencies` 字段
- `pnpm-workspace.yaml` 的 packages 列表
- `patches/` 目录下的补丁文件与对应映射
- Docker 构建脚本中对依赖文件的 COPY 限制
- `scripts/dev/README.md` 中对 pnpm 版本一致性的检查说明