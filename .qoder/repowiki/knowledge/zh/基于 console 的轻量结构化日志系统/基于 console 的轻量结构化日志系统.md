---
kind: logging_system
name: 基于 console 的轻量结构化日志系统
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - server/src/server/api.ts
    - server/src/capture/run-capture.ts
    - next.config.ts
---

## 1. 使用的系统与框架

该仓库未引入第三方日志库（如 pino、winston、bunyan、log4js 等），而是采用**极简自定义 logger**，直接基于 Node.js 内置 `console.log` / `console.error` / `console.warn` 输出。核心实现位于 `server/src/lib/logger.ts`，仅暴露 `info`、`error`、`warn` 三个方法，格式为 `[LEVEL] event_name {structured_data}`。

Next.js 前端通过 `next.config.ts` 中的 `compiler.removeConsole` 在生产构建中移除 `console.log`，但显式保留 `console.error` 和 `console.warn`，确保生产环境仍可通过错误通道输出诊断信息。

## 2. 核心文件与位置

- **logger 定义**: `server/src/lib/logger.ts` — 唯一日志门面
- **API 层使用**: `server/src/server/api.ts` — HTTP 请求/响应生命周期日志
- **采集流程**: `server/src/capture/run-capture.ts` — 页面采集各阶段日志
- **其他调用点**: `server/src/adapter/describe-assets.ts`、`server/src/capture/ai-capture-agent.ts`、`server/src/capture/credentials.ts`、`server/src/capture/imap-email.ts`、`server/src/compose/chapters/generate.ts`、`server/src/compose/chapters/root-html.ts`、`server/src/compose/render.ts`、`server/src/compose/run-pipeline.ts`、`server/src/lib/llm-response-parser.ts`、`server/src/lib/step-client.ts`、`server/src/server/job-runner.ts`
- **构建期配置**: `next.config.ts` — 控制生产环境 console 移除策略

## 3. 架构与约定

### 结构
- 单例模块导出 `{ info, error, warn }` 三个函数，无初始化过程
- 所有服务端代码统一通过相对路径 `../lib/logger` 或 `../../lib/logger` 导入
- 日志事件名采用 `模块:动作` 命名风格（如 `api:render_queued`、`run_capture:page_tokens`、`api:video_stream_failed`）

### 字段约定
- 每个日志调用第一个参数是**字符串事件名**，第二个参数可选的 `Record<string, unknown>` 结构化数据对象
- 结构化数据会被 `JSON.stringify` 后附加到消息末尾
- 错误堆栈通过 `String(err?.stack || err)` 序列化后放入 `error` 或 `stack` 字段

### 输出通道
- `info` → `console.log`（开发时可见，生产构建被移除）
- `warn` → `console.warn`（生产构建保留）
- `error` → `console.error`（生产构建保留，用于关键故障诊断）

## 4. 约定与约束

### 已观察到的模式
- 所有业务异常均通过 `logger.error` 记录，并附带可追踪的上下文字段（job id、错误信息等）
- 正常流程的关键节点使用 `logger.info` 记录结构化事件，便于按事件名聚合分析
- 降级/非致命失败使用 `logger.warn`，包含 fallback 决策依据
- Next.js 生产构建明确排除 `error` 和 `warn` 的 console 移除，确保容器日志仍有诊断能力

### 约束与限制
- 无日志级别过滤机制，无法动态调整输出粒度
- 无异步写入或缓冲，所有日志同步输出到 stdout/stderr
- 无集中式日志收集或格式化管道，依赖运行环境的日志采集器
- 前端代码不使用此 logger，脚本目录中的 `console.log` 属于一次性工具输出，不纳入应用日志体系