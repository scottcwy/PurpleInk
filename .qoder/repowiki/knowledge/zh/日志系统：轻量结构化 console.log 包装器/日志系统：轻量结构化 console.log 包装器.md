---
kind: logging_system
name: 日志系统：轻量结构化 console.log 包装器
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
    - server/src/server/api.ts
    - server/src/server/job-runner.ts
    - server/src/compose/run-pipeline.ts
---

## 1. 使用的系统/方案
- 后端（独立渲染 Worker，`server/`）使用一个极简的 `logger.ts` 模块，基于 Node 原生 `console.log` / `console.error` / `console.warn` 封装出 `info`、`warn`、`error` 三个方法。
- 前端（Next.js App Router）不引入专用日志框架，生产构建通过 `next.config.ts` 的 `compiler.removeConsole` 配置移除 `console.log`，但保留 `console.error` 和 `console.warn`，以便在容器日志中保留错误诊断信息。
- 脚本与测试工具（`scripts/`、`.data/`、`.playwright-cli/` 等）直接使用裸 `console.log`，属于一次性诊断输出，不属于运行时日志体系。

## 2. 核心文件与位置
- `server/src/lib/logger.ts` — 统一的 logger 导出 `{ info, warn, error }`，所有 server 模块通过相对路径导入。
- `next.config.ts` — 定义 `removeConsole: { exclude: ["error", "warn"] }`，控制生产环境 console 行为。
- 调用方集中在 `server/src/` 下各业务层：
  - `server/src/server/api.ts`、`job-runner.ts`（HTTP API 与 Job 执行）
  - `server/src/compose/run-pipeline.ts`（渲染管线编排）
  - `server/src/capture/*`、`server/src/adapter/*`、`server/src/lib/*`（采集、适配器、LLM 解析等）

## 3. 架构与约定
- **单点导出**：`logger` 是一个对象字面量，无构造函数、无实例化，直接 `import { logger } from "../lib/logger"` 使用。
- **结构化字段**：每个调用形式为 `logger.<level>(event: string, data?: Record<string, unknown>)`，事件名用冒号分隔的命名空间（如 `api:render_queued`、`pipeline:capture_start`、`job:done`、`job:failed`），第二个参数是可选的 JSON 序列化对象，便于下游按字段检索。
- **级别策略**：仅区分 `info` / `warn` / `error` 三级；没有 debug/trace 级别，调试信息通过 `console.log` 直接输出（例如 `run-pipeline.ts` 中金样本校验明细逐行 `console.log`）。
- **错误处理约定**：异常堆栈统一经 `errorMessage` 转换后写入 `logger.error`，对外只暴露精简 message，避免泄露本机路径或敏感信息。
- **进程内路由**：日志始终输出到标准输出/标准错误，由运行环境（Docker 容器、PM2、systemd 等）负责收集与落盘，代码层不做文件轮转、异步缓冲或远程上报。

## 4. 约定与约束
- **生产环境 console.log 被剥离**：`next.config.ts` 明确在生产构建时移除 `console.log`，仅保留 `error`/`warn`，这是经过实测验证的约束（注释说明若一并移除将导致 285 个 server chunk 中零命中关键诊断字符串）。
- **事件命名规范**：所有 logger 调用遵循 `<模块>:<动作>` 的冒号分隔事件名模式，便于在集中式日志系统中按前缀过滤。
- **数据字段安全**：传入 `data` 对象的键值必须可 JSON 序列化，且不应包含敏感信息（如密码、密钥），因为会被 `JSON.stringify` 原样输出。
- **无全局开关**：当前实现没有环境变量控制日志级别或关闭日志，无法在运行时动态调整输出粒度。
- **前端不记录业务日志**：Next.js 前端侧未引入 logger，业务诊断依赖后端返回的错误信息与浏览器开发者工具控制台。