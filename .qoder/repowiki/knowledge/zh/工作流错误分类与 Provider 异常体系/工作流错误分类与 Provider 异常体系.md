---
kind: error_handling
name: 工作流错误分类与 Provider 异常体系
category: error_handling
scope:
    - '**'
source_files:
    - src/features/ai/provider-request-error.ts
    - src/features/ai/provider-unavailable-error.ts
    - src/features/ai/route-contract-error.ts
    - src/features/ai/provider-dispatch-wait-error.ts
    - src/features/canvas/workflow-error.ts
    - src/features/canvas/workflow-fault.ts
    - docs/conventions/workflow-failure-patterns.md
    - server/src/lib/error-message.ts
    - server/src/lib/logger.ts
    - src/app/global-error.tsx
    - src/app/not-found.tsx
---

本仓库采用「类型化异常 + 统一分类器 + 安全投影」三层架构处理错误，覆盖 Next.js API、独立 Node 渲染后端与 AI 模型调用链路。

**1. 系统/模式**
- 自定义 Error 子类集中定义在 `src/features/ai/`：`ProviderRequestError`（出网边界唯一允许向工作流层传递的 Provider 异常）、`ProviderUnavailableError`（主备均不可用熔断）、`RouteContractError`（路由/能力合同矛盾）、`ProviderDispatchWaitError`（调度排队等待）。
- 所有外部响应、Prompt、凭据仅保留在内存 `cause` 中，禁止序列化进节点、Artifact 或 `task_attempts.failure`。
- 统一分类入口 `classifyWorkflowError`（`src/features/canvas/workflow-error.ts`）按三段顺序判定：`classifyByType`（类型优先，zod/Director 等结构性错误）→ `classifyByMessage`（文案规则正则匹配）→ `classifyByStage`（阶段兜底），确保内部错误不被误标为可重试的外部故障。
- 结构化故障投影 `WorkflowFault`（`schemaVersion: 2`）包含 code、origin、stage、title、message、retryable、recovery、referenceId、occurredAt 及可选 provider 信息，由 `projectProviderFault` / `completeWorkflowFault` 生成。
- 服务端对外错误文案通过 `server/src/lib/error-message.ts` 的 `errorMessage` 函数只提取 message，不泄露 stack/绝对路径。

**2. 关键文件与包**
- `src/features/ai/provider-request-error.ts` — ProviderRequestError 及其 HTTP 状态到 kind 映射、Retry-After 解析、安全消息生成。
- `src/features/ai/provider-unavailable-error.ts`、`route-contract-error.ts`、`provider-dispatch-wait-error.ts` — 专用业务异常。
- `src/features/canvas/workflow-error.ts` — classifyWorkflowError、MESSAGE_RULES、STAGE_FALLBACKS、Zod 违规路径描述。
- `src/features/canvas/workflow-fault.ts` — WorkflowFaultCode 全集、origin/recovery 枚举、providerClassification、presentationFor。
- `docs/conventions/workflow-failure-patterns.md` — 失败模式手册（A~P 共 16 种真实事故模式及护栏），是错误处理的权威约定文档。
- `server/src/lib/logger.ts` — 简单 console 日志包装。
- `src/app/global-error.tsx`、`src/app/not-found.tsx` — Next.js 根级错误边界与 404 页面，只展示类别与 digest，不回显原始错误。

**3. 架构与约定**
- 错误传播链：各阶段抛出具体 Error → `classifyWorkflowError` 投影为 `WorkflowErrorProjection` → 持久化为 `task_attempts.failure`（脱敏结构化故障）→ UI 读取 `canvas_nodes.status` + `data.payload.directorError` 显示。
- 四类容灾护栏（模式 H）：进程中断自动回收（lease 租约）→ 自动重试+预算闸门（RETRY_BUDGET_EXHAUSTED）→ 人为跳过（skipped 一等状态）→ Provider 熔断+降级（provider-breaker）。
- 限流与等待（模式 M）：`ProviderDispatchWaitError` 复用同一 attempt 并推迟 visibleAt，避免制造重试记录；429 遵循 Retry-After 退避，单任务累计最多 15 分钟终态化为 PROVIDER_RATE_LIMITED。
- 诊断顺序强制：先查 `canvas_nodes.status` + `directorError`，再查 `task_attempts.failure`，再查 attempt 时长与 artifacts 表，最后看 dev server 日志。

**4. 约束与规则**
- 类型永远优先于文案：zod 报文含 required/invalid 等词，靠关键词匹配必然误判，必须先用 `classifyByType` 识别。
- 内部矛盾（RouteContractError、QuotaExhaustedError、DirectorPreflightError 等）必须 `retryable=false`，禁止出现「所有未识别错误都自称渲染失败」。
- 文案不得回显字段取值、原稿、prompt、凭据或 provider 原始响应；只暴露 zod 合同字段路径（如 `target.sourceUnit.order`）。
- 兜底类别必须按阶段职责给：RENDER_FAILED 仅属 RENDER，MEDIA_FAILED 仅属 MEDIA_NARRATION，文本阶段用 STAGE_FAILED 且带阶段名。
- 异步媒体未就绪（MEDIA_NOT_READY）必须排在「上游产物缺失」规则之前，因其文案含「缺少」。
- 复合队列子阶段必须继承父 attempt 的真实 id，出网前失败保留原始类型并绕过 Provider 熔断记账。
- Provider 硬超时必须短于阶段执行上限，SDK 内重试关闭，由队列统一重试预算负责。
- 数据库时钟 `databaseNow` 返回值必须经过 instanceof Date + getTime() 有效性三重防御，传入 Drizzle 算子前保证可序列化。
- 真实产物证据：artifacts.content_hash 与磁盘字节 SHA-256 需逐条核对一致。