---
kind: logging_system
name: 日志系统（Logger）
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
---

## 系统与框架
- 服务端（server/）使用自实现的轻量 logger：`server/src/lib/logger.ts`，仅暴露 `info`、`error`、`warn` 三个方法，内部直接调用 `console.log` / `console.error` / `console.warn`，并以 `[INFO]`、`[ERROR]`、`[WARN]` 前缀 + JSON 序列化结构化字段输出。
- 前端（src/）未引入统一 logger 库，直接使用原生 `console.*`（`console.info`、`console.warn`、`console.error`），并通过 Next.js 构建配置在生产环境移除 `console.log`，但保留 `error` / `warn`。

## 关键文件与包
- `server/src/lib/logger.ts` — 服务端唯一日志入口，被 adapter、capture、compose、server、lib 等模块导入使用。
- `next.config.ts` — 通过 `compiler.removeConsole.exclude: ["error", "warn"]` 控制生产构建时 console 的剔除策略。

## 架构与约定
- **单点 logger**：所有 server 模块统一从 `../lib/logger` 或 `../../lib/logger` 导入同一对象，避免各自实现差异。
- **结构化字段**：每个日志调用接受 `(event: string, data?: Record<string, unknown>)`，event 为事件名，data 以 `JSON.stringify` 输出，便于下游日志聚合解析。
- **分级策略**：仅定义 info / warn / error 三级，无 debug；错误路径一律走 `logger.error` 或 `console.error`，告警用 `logger.warn` / `console.warn`，常规信息用 `logger.info` / `console.info`。
- **前后端分离**：前端不依赖 server 的 logger，直接写 `console.*`；Next 构建期按环境剥离 `console.log`，保证生产容器日志只包含 error/warn 诊断信息。

## 约定与约束
- 服务端日志必须通过 `server/src/lib/logger.ts` 导出对象，禁止在 server 代码中直接散落 `console.log`（现有用法均经该 logger）。
- 生产构建禁止输出 `console.log`，仅允许 `console.error` 和 `console.warn` 进入最终产物（由 `next.config.ts` 强制）。