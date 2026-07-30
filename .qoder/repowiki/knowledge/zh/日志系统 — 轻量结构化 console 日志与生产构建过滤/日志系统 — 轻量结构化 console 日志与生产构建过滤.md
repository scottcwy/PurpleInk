---
kind: logging_system
name: 日志系统 — 轻量结构化 console 日志与生产构建过滤
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
    - server/src/server/job-runner.ts
    - server/src/capture/run-capture.ts
---

## 系统与框架
- 服务端（server/）使用一个极简的自定义 logger，基于 Node 原生 `console.log` / `console.error` / `console.warn` 封装，无第三方日志库。
- 前端 Next.js 通过 `next.config.ts` 的 `compiler.removeConsole` 在生产环境移除 `console.log`，但保留 `error` 和 `warn`，确保生产容器日志仍有可归因信息。
- 脚本与测试工具普遍直接使用 `console.log` / `console.error`，未接入统一 logger。

## 核心文件与位置
- `server/src/lib/logger.ts`：唯一的服务端日志门面，导出 `{ info, warn, error }` 三个方法，格式为 `[LEVEL] event` + 可选 JSON 字段对象。
- `next.config.ts`：配置生产构建移除 `console.log`，仅保留 `error`、`warn`。
- server 各模块通过 `import { logger } from "../lib/logger"` 或相对路径引入该 logger。

## 架构与约定
- **单点门面**：所有服务端业务代码（capture、compose、server/api、job-runner、adapter 等）统一从 `server/src/lib/logger.ts` 导入 logger，避免散落调用。
- **结构化字段**：logger 的每个方法接受 `(event: string, data?: Record<string, unknown>)`，`data` 会被 `JSON.stringify` 追加到输出行，便于下游解析。
- **事件命名**：采用短横线分隔的事件名前缀，如 `run_capture:page_tokens`、`job:done`、`job:failed`、`run_capture:complexity` 等，体现“模块:动作”的层级。
- **错误处理策略**：业务异常通过 `logger.error("job:failed", { id, stack })` 记录完整堆栈；对外响应只暴露 message，不泄露本机路径。
- **级别使用**：info 用于正常流程里程碑（任务完成、采集结束），warn 用于可恢复异常（页面 token 提取失败、布局提取失败），error 用于不可恢复错误（job 失败）。

## 约束与规则
- **生产构建过滤**：`next.config.ts` 中 `removeConsole.exclude = ["error", "warn"]`，确保生产环境仍保留错误与警告输出，这是经过实测验证的规则（注释说明若一并移除会导致 285 个 server chunk 零命中诊断信息）。
- **无全局配置**：logger 没有级别开关、格式化器或 sink 配置，所有输出直接走进程 stdout/stderr。
- **无请求追踪 ID**：当前 logger 调用未注入 requestId/correlationId 等上下文字段，跨服务关联依赖上层传入（如 job-runner 中的 `integratedRequestId` 透传但不写入日志）。
- **前端不使用该 logger**：Next.js 前端代码未引用 `server/src/lib/logger.ts`，前端日志依赖浏览器控制台与 Next 构建期过滤。

## 使用模式示例
```typescript
// 成功路径
logger.info("job:done", { id: job.id, videoPath, checkPassed })

// 失败路径
logger.error("job:failed", { id: job.id, stack: String(err?.stack || err) })

// 可恢复异常
logger.warn("run_capture:page_tokens_failed", { error: String(err) })
```
