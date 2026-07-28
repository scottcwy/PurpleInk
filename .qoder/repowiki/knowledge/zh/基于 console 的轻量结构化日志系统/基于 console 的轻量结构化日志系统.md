---
kind: logging_system
name: 基于 console 的轻量结构化日志系统
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
    - server/src/server/api.ts
    - server/src/server/job-runner.ts
---

该仓库采用极简的本地 logger 模块，未引入第三方日志框架（如 winston、pino、bunyan），而是通过一个仅 13 行的 `server/src/lib/logger.ts` 封装 `console.log/error/warn`，以 `[INFO] / [ERROR] / [WARN]` 前缀 + 事件名 + JSON 序列化数据对象的方式输出结构化日志。

**系统与架构**
- 核心实现：`server/src/lib/logger.ts` 暴露统一的 `logger.info | warn | error` 三个方法，参数为 `(event: string, data?: Record<string, unknown>)`，将 event 与 data 序列化为 JSON 字符串输出。
- 使用范围：所有 server/Worker 子包中的业务模块均通过相对路径导入该 logger，包括 `adapter/*`、`capture/*`、`compose/*`、`lib/*`、`server/api.ts`、`server/job-runner.ts` 等，形成统一的日志入口。
- 前端 Next.js 应用未使用该 logger，脚本目录（scripts/*）直接使用 `console.log` 做调试输出。

**日志级别策略**
- 仅使用 info、warn、error 三级，无 debug 级别。
- 生产构建通过 Next.js `compiler.removeConsole` 配置保留 `error` 和 `warn`，移除 `log`，确保生产环境仍能看到错误与警告诊断信息（见 `next.config.ts` 第 23-32 行注释说明）。
- 服务端 API 启动时仍用 `console.log` 打印帮助提示，属于一次性启动信息，不受 removeConsole 影响。

**结构化字段约定**
- 每个日志调用包含一个语义化事件名（如 `api:render_queued`、`ai_capture:step`、`job:done`、`job:failed`），便于在日志系统中按事件过滤。
- 第二个参数为可选的上下文对象，通常包含 `id`、`url`、`step`、`error`、`stack` 等键，全部经 `JSON.stringify` 序列化后拼接输出。
- 错误堆栈统一通过 `errorMessage(err)` 工具函数处理后写入 `stack` 字段，避免直接暴露本机路径。

**约束与限制**
- 无日志级别开关、无异步写入、无文件/网络 sink，所有输出均走进程标准输出，依赖容器或进程管理器收集。
- 无请求 ID 追踪、无采样率控制、无敏感字段脱敏逻辑，敏感信息需由调用方自行处理。
- 前端代码不经过此 logger，测试与脚本使用原生 `console.*`，未纳入统一规范。