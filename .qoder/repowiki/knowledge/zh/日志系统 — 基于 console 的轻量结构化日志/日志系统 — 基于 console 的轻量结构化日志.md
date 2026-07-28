---
kind: logging_system
name: 日志系统 — 基于 console 的轻量结构化日志
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - server/src/server/job-runner.ts
    - server/src/capture/ai-capture-agent.ts
    - next.config.ts
---

本仓库采用极简的自定义 logger，未引入第三方日志框架（如 pino、winston、bunyan 等），所有服务端日志均通过 `server/src/lib/logger.ts` 暴露的统一接口输出到标准输出/错误流。

**1. 使用的系统与工具**
- 核心实现：`server/src/lib/logger.ts` 导出一个包含 `info`、`warn`、`error` 三个方法的对象，内部直接调用 `console.log` / `console.warn` / `console.error`。
- 日志格式：每条日志以 `[INFO]` / `[WARN]` / `[ERROR]` 前缀开头，事件名作为第一个参数，第二个可选参数为结构化数据对象（会被 `JSON.stringify`）。
- Next.js 构建期处理：`next.config.ts` 在生产环境启用 `compiler.removeConsole.exclude: ["error", "warn"]`，确保 `console.error` 和 `console.warn` 不被移除，而 `console.log` 会被剥离。

**2. 关键文件与包**
- `server/src/lib/logger.ts` — 唯一日志门面，定义 info/warn/error 三方法。
- `server/src/server/job-runner.ts` — 任务执行器，使用 `logger.info("job:done")` 和 `logger.error("job:failed")` 记录任务生命周期。
- `server/src/capture/ai-capture-agent.ts` — AI 采集代理，大量使用 `logger.info("ai_capture:*")` 和 `logger.warn("ai_capture:*")` 记录步骤、截图、认证、决策等事件。
- `server/src/adapter/describe-assets.ts`、`server/src/compose/render.ts`、`server/src/compose/run-pipeline.ts`、`server/src/lib/llm-response-parser.ts`、`server/src/lib/step-client.ts`、`server/src/server/api.ts` 等均通过 `import { logger } from "../lib/logger"` 使用统一日志。
- `next.config.ts` — 控制生产构建中 `console.log` 的移除策略，保留 error/warn 用于诊断。

**3. 架构与约定**
- **单一入口**：所有 server 端模块通过相对路径导入同一个 `logger` 实例，无全局配置或注入机制。
- **结构化字段**：每个日志调用携带一个事件名（字符串）和一个可选的 `Record<string, unknown>` 数据对象，便于后续解析。
- **分层记录**：`info` 用于正常流程推进（如 job 完成、采集步骤）、`warn` 用于可恢复异常（如截图失败、AI 决策失败）、`error` 用于致命错误（如 job 失败、stack trace）。
- **错误安全**：`job-runner.ts` 在 catch 分支中将完整 stack 仅写入服务端日志，对外只返回 message，避免泄露敏感信息。
- **进程边界**：日志仅存在于独立的 `server/` 工作进程中；Next.js 前端通过 `/api/engine/*` 反向代理访问，前端本身不直接输出业务日志。

**4. 约定与约束**
- **必须使用 `logger` 而非裸 `console`**：server 端代码统一通过 `import { logger }` 使用，脚本目录（`scripts/`、`.data/`）中的调试脚本直接使用 `console.log`/`console.error`，但业务代码不这样做。
- **事件命名规范**：事件名采用 `模块:子模块:动作` 的三段式结构（如 `ai_capture:step`、`job:done`、`adapter:vision_describe_failed`），便于按模块过滤。
- **生产构建约束**：`next.config.ts` 明确禁止在生产环境移除 `console.error` 和 `console.warn`，否则将丢失所有诊断信息（注释中说明实测 285 个 chunk 中零命中）。
- **无日志级别开关**：当前实现没有运行时日志级别配置，所有级别的日志都会输出，依赖外部容器/平台进行筛选。
- **无异步落盘**：日志直接写入 stdout/stderr，未实现文件落盘、远程上报或采样降频。