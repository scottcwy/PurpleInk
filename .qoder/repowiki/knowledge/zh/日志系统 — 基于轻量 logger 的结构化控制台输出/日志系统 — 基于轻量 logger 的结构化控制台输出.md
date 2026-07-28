---
kind: logging_system
name: 日志系统 — 基于轻量 logger 的结构化控制台输出
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
    - server/src/server/api.ts
    - server/src/capture/ai-capture-agent.ts
---

本仓库采用极简的自定义 logger，未引入第三方日志框架（如 winston、pino、bunyan 等），所有服务端日志通过 `server/src/lib/logger.ts` 提供的统一对象输出到标准输出/错误流。

**系统与架构**
- 核心实现位于 `server/src/lib/logger.ts`，仅暴露 `info`、`warn`、`error` 三个方法，分别调用 `console.log`、`console.warn`、`console.error`。
- 每个日志调用接受两个参数：事件名（字符串）和可选的附加数据（`Record<string, unknown>`），数据会被 `JSON.stringify` 序列化后追加输出，形成“事件 + JSON 字段”的结构化格式。
- Next.js 前端侧不依赖该 logger，生产构建通过 `next.config.ts` 的 `compiler.removeConsole` 配置移除 `console.log`，但显式保留 `error` 和 `warn`，确保生产环境仍能捕获分类后的诊断信息。

**使用范围与约定**
- 仅在 `server/` 子项目中使用，被 adapter、capture、compose、lib、server 等模块导入，例如 `api.ts`、`job-runner.ts`、`ai-capture-agent.ts`、`describe-assets.ts` 等。
- 事件命名采用 `模块:动作` 风格（如 `api:render_queued`、`ai_capture:step`、`adapter:vision_describe_failed`），便于按前缀过滤。
- 脚本目录（`scripts/`）中的工具脚本直接使用 `console.log` / `console.error`，不走统一 logger，属于一次性任务场景。

**约束与行为**
- 无日志级别开关或采样策略，所有级别的日志均直接输出。
- 无文件/远程 sink，日志仅落至进程 stdout/stderr，由容器或运行环境收集。
- 生产环境 `console.log` 被移除，但 `logger.info` 仍会输出（因其内部调用 `console.log`，不受 `removeConsole.exclude` 影响——实际效果取决于打包器对 `console.log` 的识别方式；代码注释明确说明需保留 error/warn 以获取诊断信息）。
- 未定义统一的错误对象结构，错误信息通过 `String(err)` 或 `errorMessage(err)` 转换后放入 data 字段。