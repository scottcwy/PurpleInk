---
kind: logging_system
name: 日志系统 — 基于 console 的轻量结构化日志
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
    - server/src/capture/ai-capture-agent.ts
    - server/src/server/job-runner.ts
    - server/src/compose/run-pipeline.ts
---

## 1. 使用的框架/方案
项目未引入第三方日志库（如 pino、winston、bunyan 等），而是采用**极简自实现 logger**：`server/src/lib/logger.ts` 导出一个包含 `info`、`warn`、`error` 三个方法的对象，内部直接调用 `console.log` / `console.warn` / `console.error`，并以 `[INFO]`、`[WARN]`、`[ERROR]` 前缀 + JSON 序列化可选 data 字段的方式输出结构化日志。

## 2. 核心文件与位置
- **logger 定义**：`server/src/lib/logger.ts`（仅 13 行，从 Firenze frameproof 原样拷贝）
- **服务端使用方**（均通过相对路径导入）：
  - `server/src/adapter/describe-assets.ts`
  - `server/src/capture/ai-capture-agent.ts`
  - `server/src/capture/credentials.ts`
  - `server/src/capture/imap-email.ts`
  - `server/src/capture/run-capture.ts`
  - `server/src/compose/chapters/generate.ts`
  - `server/src/compose/chapters/root-html.ts`
  - `server/src/compose/render.ts`
  - `server/src/compose/run-pipeline.ts`
  - `server/src/lib/llm-response-parser.ts`
  - `server/src/lib/step-client.ts`
  - `server/src/server/api.ts`
  - `server/src/server/job-runner.ts`
- **前端构建期过滤**：`next.config.ts` 中配置 `compiler.removeConsole` 在生产环境排除 `error`、`warn`，保留这两类输出。

## 3. 架构与约定
- **统一入口**：所有服务端模块通过 `import { logger } from "../lib/logger"`（或对应相对路径）获取同一个 logger 实例，避免分散的 console 调用。
- **结构化字段约定**：每个日志调用遵循 `(event: string, data?: Record<string, unknown>)` 签名，event 为短横线分隔的事件名（如 `ai_capture:step`、`adapter:vision_describe_failed`），data 为可选的键值对对象，会被 `JSON.stringify` 后附加在消息之后。
- **日志级别策略**：仅区分 info / warn / error 三级；错误场景优先用 `logger.warn`（如截图失败、AI 决策失败、循环检测），严重异常用 `logger.error`。
- **生产构建行为**：Next.js 构建时 `removeConsole.exclude = ["error", "warn"]` 确保生产包仍保留 `console.error` 和 `console.warn`，以便容器日志中可归因诊断信息（见 next.config.ts 注释说明）。
- **前端 vs 后端边界**：前端代码直接使用 `console.log`（脚本/测试工具中尤为常见），而业务服务端逻辑统一走 `logger` 模块，形成前后端不同的输出策略。

## 4. 约定与约束
- **事件命名规范**：事件名采用 `模块:动作` 形式（如 `ai_capture:step`、`adapter:vision_describe_failed`），便于按模块筛选。
- **数据字段必须可 JSON 序列化**：`data` 参数类型为 `Record<string, unknown>`，实际调用中传入的对象均被 `JSON.stringify`，因此不应包含不可序列化的引用。
- **禁止绕过 logger**：服务端业务代码应通过 `logger` 模块输出，而非直接调用 `console.*`；目前所有 server/src 下的业务模块均遵守此约定。
- **生产环境不输出 info**：虽然 logger.info 本身未被构建期移除，但结合 Next.js 的 `removeConsole` 配置，前端 `console.log` 会在生产构建中被剔除，后端则依赖运行时的 stdout/stderr 收集。
- **无日志级别开关/采样/异步落盘**：当前实现是同步直写 stdout/stderr，没有分级开关、采样率控制或文件/远程 sink，属于开发/调试阶段的轻量方案。