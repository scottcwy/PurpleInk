---
kind: logging_system
name: 日志系统 — 轻量结构化 logger 与 console 输出策略
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
    - server/src/capture/ai-capture-agent.ts
    - server/src/adapter/describe-assets.ts
    - server/src/server/api.ts
---

## 1. 使用的框架/方案
- 服务端（server/）采用自实现的极简 `logger` 模块，直接基于 Node.js `console.log / console.warn / console.error` 输出，无第三方日志库依赖。
- 前端（Next.js 应用）在生产构建中通过 `compiler.removeConsole` 移除 `console.log`，但显式保留 `console.error` 和 `console.warn`，确保生产环境仍可输出诊断信息。

## 2. 核心文件与位置
- `server/src/lib/logger.ts`：统一的 logger 导出，提供 `info(event, data?)`、`warn(event, data?)`、`error(event, data?)` 三个方法。
- `next.config.ts`：配置 `removeConsole: { exclude: ["error", "warn"] }`，控制前端构建期 console 输出策略。

## 3. 架构与约定
- **统一入口**：所有 server 模块通过相对路径导入 `../lib/logger`（或同级 `./logger`），避免散落 `console.*` 调用。被导入的模块包括 capture、adapter、compose、server、lib 等子目录中的多个文件（如 `ai-capture-agent.ts`、`describe-assets.ts`、`step-client.ts`、`job-runner.ts`、`api.ts` 等）。
- **结构化字段**：每个日志方法接收两个参数：
  - `event`: 字符串事件名（如 `ai_capture:on_screenshot_failed`、`ai_capture:auth_success_detected`、`adapter:vision_describe_failed`），用于标识日志来源与语义。
  - `data?`: `Record<string, unknown>` 可选上下文对象，会被 `JSON.stringify` 后作为第二个参数输出。
- **输出格式**：形如 `[INFO] ai_capture:step { ... }`，级别前缀用方括号标注，便于 grep/过滤。
- **错误处理**：`error` 级别走 `console.error`，`warn` 走 `console.warn`，`info` 走 `console.log`，保证不同严重程度的日志进入不同的标准流。

## 4. 约定与约束
- **事件命名约定**：事件名采用 `<模块>:<动作>` 形式（如 `ai_capture:*`、`adapter:*`），便于按模块聚合分析。
- **数据序列化**：`data` 字段必须为可 JSON 序列化的对象；若包含不可序列化值（如 Error 实例），需先转为 `String(err)` 或提取关键字段。
- **前端构建约束**：`next.config.ts` 明确禁止在生产环境移除 `console.error` 和 `console.warn`，注释说明这是为了保证“分类后的诊断信息只经 console.error 落到服务端日志”，否则生产节点失败时将无任何归因信息。
- **无日志级别开关**：当前实现没有环境变量或配置项来动态开启/关闭特定级别日志，所有级别始终输出。
- **无异步/缓冲/轮转**：logger 是同步直接写入 stdout/stderr，无队列、无文件落盘、无日志轮转机制。
- **脚本与工具类代码**：`scripts/` 下的迁移、验证脚本直接使用 `console.error` / `console.warn` 输出，未使用统一 logger，属于一次性工具场景。

## 5. 使用模式示例
```typescript
import { logger } from "../lib/logger"

// 记录步骤信息
logger.info("ai_capture:step", { step, action })

// 记录警告
logger.warn("ai_capture:on_screenshot_failed", { error: String(err) })

// 记录错误
logger.error("adapter:vision_describe_failed", { path: a.path, error: String(err) })
```

## 6. 局限性与观察
- 缺少结构化日志解析能力（如 JSON Lines 消费）、采样/限流、远程上报、traceId/correlationId 关联等高级特性。
- 前端与后端日志输出方式不一致：前端走浏览器 console，后端走 Node console，缺乏统一采集管道。
- 日志内容以文本拼接为主，尚未形成标准化的 schema 或字段规范文档。