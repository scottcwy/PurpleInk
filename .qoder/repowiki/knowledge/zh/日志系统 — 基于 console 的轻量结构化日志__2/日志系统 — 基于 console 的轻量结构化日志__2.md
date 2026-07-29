---
kind: logging_system
name: 日志系统 — 基于 console 的轻量结构化日志
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
    - server/src/server/job-runner.ts
    - server/src/capture/ai-capture-agent.ts
---

## 1. 使用的框架与方式
- 未引入第三方日志库（如 pino、winston、bunyan 等），采用 Node.js 原生 `console.log / console.error / console.warn` 作为唯一输出通道。
- 在 server/worker 侧通过一个极简的 `logger` 模块统一封装，对外暴露 `info`、`warn`、`error` 三个方法，内部直接调用对应的 `console.*` 并附带 `[INFO]`、`[WARN]`、`[ERROR]` 前缀。
- Next.js 前端在生产构建中通过 `compiler.removeConsole` 移除 `console.log`，但显式保留 `console.error` 和 `console.warn`，确保生产环境仍能看到错误与警告。

## 2. 核心文件与位置
- `server/src/lib/logger.ts`：统一的 logger 实现，所有 server/worker 代码均从此处导入。
- `next.config.ts`：Next 构建配置中对 `removeConsole` 的策略声明，是前端日志输出的唯一控制点。
- 使用方集中在 server/worker 的各业务模块中，例如 `server/src/server/job-runner.ts`、`server/src/capture/ai-capture-agent.ts`、`server/src/compose/run-pipeline.ts`、`server/src/server/api.ts`、`server/src/lib/step-client.ts`、`server/src/lib/llm-response-parser.ts` 等。

## 3. 架构与约定
- **单一 logger 入口**：server/worker 的所有模块通过相对路径导入 `../lib/logger`，避免各自实现不同的输出逻辑。
- **结构化字段**：每个 `logger.info/warn/error` 调用都遵循 `(event: string, data?: Record<string, unknown>)` 签名，event 为短横线分隔的事件名（如 `job:done`、`job:failed`、`ai_capture:step`、`adapter:vision_describe_failed`），data 为可选的 JSON 对象，会被 `JSON.stringify` 后追加到同一行输出。
- **事件命名约定**：事件名按“模块:动作”组织，如 `ai_capture:*`、`job:*`、`adapter:*`，便于在日志中快速定位来源。
- **错误处理策略**：业务异常通过 `logger.error` 记录完整堆栈（`String(err?.stack || err)`），而对外只返回脱敏后的 `errorMessage(err)`，避免泄露本机路径或敏感信息。
- **生产构建过滤**：Next.js 在生产环境下自动移除 `console.log`，但保留 `console.error` 和 `console.warn`；这意味着前端调试日志不会泄漏到生产，但错误与警告仍可被容器日志捕获。

## 4. 约定与约束
- **无分级开关**：当前 logger 没有级别过滤或采样机制，所有 `info/warn/error` 都会输出，无法通过环境变量动态调整。
- **无外部 sink**：日志仅输出到标准输出/错误流，未集成文件写入、远程收集（如 ELK、Sentry）或结构化日志格式（如 JSON Lines）。
- **前端禁用 debug 日志**：通过 `next.config.ts` 的 `removeConsole.exclude: ["error", "warn"]` 强制禁止生产环境输出 `console.log`，开发者需改用 `logger.error` 或 `logger.warn` 来保证关键信息可被观测。
- **脚本与工具类代码**：`scripts/` 目录下的迁移、验证、e2e 脚本直接使用 `console.log` 进行进度输出，不经过 logger 模块，属于一次性工具场景。
- **AGENTS.md §6 约束**：明确要求“不展示 raw assistant delta、tool 参数值、prompt、credential、provider 原始错误或隐藏推理”，这与 logger.error 中仅记录脱敏 message、完整堆栈仅入服务端日志的做法一致。

## 5. 适用性与改进空间
- 当前系统适合小型 worker 进程的快速排障，结构简单、零依赖。
- 若需要集中采集、结构化查询、采样降载或告警联动，建议引入专业日志库（如 pino）并统一替换现有 `console.*` 调用。