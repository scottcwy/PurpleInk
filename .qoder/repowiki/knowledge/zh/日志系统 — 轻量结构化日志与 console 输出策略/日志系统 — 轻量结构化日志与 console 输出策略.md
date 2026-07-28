---
kind: logging_system
name: 日志系统 — 轻量结构化日志与 console 输出策略
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - server/src/server/api.ts
    - server/src/server/job-runner.ts
    - src/instrumentation.ts
    - next.config.ts
---

本仓库的日志系统采用极简方案：在独立渲染 Worker（server/）中通过一个本地 logger 模块统一输出结构化日志，在生产构建阶段由 Next.js 配置控制 console 输出保留策略。具体要点如下：

1. 使用的框架与工具
- server/ 子项目使用自实现的轻量 logger（server/src/lib/logger.ts），仅封装 info/warn/error 三个方法，底层直接调用 console.log/console.error/console.warn。
- 日志格式为 `[LEVEL] event_name` + 可选的 JSON 序列化 data 对象，便于后续用文本工具或日志采集器解析。
- Next.js 前端侧未引入专用日志库，关键启动逻辑通过 instrumentation.ts 中的 console.error 输出队列初始化状态。
- next.config.ts 明确注释说明：生产构建会移除 console.log，但必须保留 console.error 和 console.warn，以保证容器日志可用。

2. 核心文件与位置
- server/src/lib/logger.ts：统一的 logger 导出，提供 info/warn/error 三方法。
- server/src/server/api.ts：HTTP API 入口，所有请求处理异常、视频流失败、服务监听等通过 logger 记录。
- server/src/server/job-runner.ts：Job 执行器，成功与失败路径分别以 logger.info / logger.error 记录 job:done 与 job:failed。
- src/instrumentation.ts：Next.js 进程启动钩子，队列初始化失败时通过 console.error 输出兜底信息。
- next.config.ts：包含关于生产环境 console 输出的注释性约束。

3. 架构与约定
- 日志来源分层：server/ 子项目内各模块（adapter、capture、compose、lib、server）统一从 ../lib/logger 导入 logger，形成单一出口；scripts/ 与测试脚本直接使用 console.*，不经过 logger。
- 事件命名约定：logger 的第一个参数是短横线分隔的事件名（如 api:render_queued、job:done、job:failed、api:video_stream_failed、api:unhandled），第二个参数是可选的结构化数据对象，会被 JSON.stringify 后追加到同一行。
- 错误处理约定：对外只返回人类可读的错误 message（通过 errorMessage 包装），完整堆栈仅写入 logger.error，避免泄露本机路径。
- 无日志级别过滤：当前 logger 没有 level 配置，info/warn/error 均直接输出，依赖外部日志采集层按前缀或关键字筛选。
- 无异步落盘或缓冲：所有日志同步写入 stdout/stderr，适合容器化部署场景。

4. 约定与约束
- server/ 业务代码必须通过 import { logger } from "../lib/logger" 使用统一 logger，禁止在各处直接写 console.log 输出业务日志（scripts/ 除外）。
- 事件名需遵循 `模块:动作` 的短横线命名风格，便于按模块聚合查询。
- 结构化字段应放入第二个参数对象，且值需可 JSON 序列化。
- 生产环境中 console.log 会被构建工具移除，因此调试信息应改用 logger.info 或 logger.warn，确保容器日志中仍可见。
- 前端 instrumentation.ts 仅在 nodejs 运行时初始化队列，edge runtime 跳过，避免副作用。

总体而言，该项目的日志系统是一个“零依赖、单文件、结构化事件”的轻量实现，满足独立渲染 Worker 的可观测需求，但未提供日志级别、采样、异步写入、多目标路由等企业级能力。