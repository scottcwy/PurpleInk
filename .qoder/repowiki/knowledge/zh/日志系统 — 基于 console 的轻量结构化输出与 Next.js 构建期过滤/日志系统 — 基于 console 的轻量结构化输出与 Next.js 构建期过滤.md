---
kind: logging_system
name: 日志系统 — 基于 console 的轻量结构化输出与 Next.js 构建期过滤
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
    - server/src/index.ts
---

## 系统与框架
本项目未引入第三方日志库（如 pino、winston、bunyan 等），而是采用最简方案：在渲染后端（server/）中通过一个本地 logger 模块封装 `console.log / console.error / console.warn`，在前端由 Next.js 构建配置控制 `console.log` 的移除策略。

## 核心文件与位置
- `server/src/lib/logger.ts`：后端统一的 logger 接口，提供 `info`、`warn`、`error` 三个方法，输出格式为 `[LEVEL] event` + 可选 JSON 数据。
- `next.config.ts`：Next.js 构建配置，生产环境启用 `compiler.removeConsole = { exclude: ["error", "warn"] }`，仅保留 `console.error` 和 `console.warn`，`console.log` 被移除。
- `server/src/index.ts`：后端入口，启动失败时直接 `console.error("[server] 启动失败：", err)`。

## 架构与约定
- **分层输出**：后端使用 `logger.info/warn/error` 统一打点；脚本类工具（scripts/*）直接使用 `console.log` 与 `console.error` 输出进度与错误。
- **结构化字段**：logger 的第二个参数接受 `Record<string, unknown>`，并以 `JSON.stringify` 序列化后追加到日志行，形成简单的键值对结构。
- **级别策略**：仅定义 info / warn / error 三级，无 debug 级别；错误信息统一走 `console.error`，确保在生产构建中不被剥离。
- **前端日志裁剪**：通过 Next.js 的 `removeConsole.exclude` 白名单机制，保证生产环境中只有 error 与 warn 能落到容器 stdout/stderr，避免敏感调试信息泄露同时保留可诊断性。

## 约束与规范
- 生产构建必须保留 `console.error` 与 `console.warn`，这是由 `next.config.ts` 中的注释明确说明的硬性要求——若一并移除，将导致服务故障时容器日志无任何归因信息。
- 所有服务端日志应通过 `server/src/lib/logger.ts` 的 `logger` 对象输出，而非直接调用 `console.*`，以保证格式一致。
- 脚本与测试代码不受此约束，可直接使用 `console.log` / `console.error` 进行一次性输出。

## 局限
- 无集中式日志收集、无分级开关、无异步写入、无请求上下文关联（如 traceId），属于开发/部署阶段的最小可行实现。