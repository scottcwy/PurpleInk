---
kind: error_handling
name: PurpleInk 工作流错误分类与统一处理体系
category: error_handling
scope:
    - '**'
source_files:
    - src/features/canvas/workflow-error.ts
    - src/features/canvas/workflow-fault.ts
    - src/features/ai/provider-request-error.ts
    - src/features/ai/provider-unavailable-error.ts
    - src/features/ai/route-contract-error.ts
    - src/features/auth/unauthenticated-error.ts
    - src/app/global-error.tsx
    - src/app/not-found.tsx
    - src/app/products/(app)/error.tsx
    - src/app/products/(app)/not-found.tsx
    - src/app/api/render/route.ts
    - src/app/api/director/pipeline/route.ts
    - src/app/api/director/stage/route.ts
    - src/lib/api.ts
---

## 1. 系统/方法概述
本项目采用「自定义错误类型 + 集中式工作流错误分类器 + Next.js 错误边界」三层架构：
- 业务层抛出语义明确的 Error 子类（如 ProviderRequestError、RouteContractError、ProviderUnavailableError、QuotaExhaustedError 等）；
- `classifyWorkflowError` 将任意异常投影为统一的 `WorkflowFault`（含 code、message、retryable、origin、recovery 等字段），按「类型优先 → 文案匹配 → 阶段兜底」三段判定；
- API 路由统一 catch 后返回 `{ ok, error, code }`，前端 UI 通过 digest/referenceId 对账，不暴露原始堆栈或凭据。

## 2. 关键文件与包
- 错误分类核心：`src/features/canvas/workflow-error.ts`、`src/features/canvas/workflow-fault.ts`
- Provider 出网边界错误：`src/features/ai/provider-request-error.ts`、`src/features/ai/provider-unavailable-error.ts`、`src/features/ai/route-contract-error.ts`、`src/features/ai/provider-dispatch-wait-error.ts`
- 认证错误：`src/features/auth/unauthenticated-error.ts`
- 计费/配额错误：`src/features/billing/contracts.ts`（QuotaExhaustedError、BillingIdempotencyConflictError）
- Next.js 全局错误边界：`src/app/global-error.tsx`、`src/app/not-found.tsx`、`src/app/products/(app)/error.tsx`、`src/app/products/(app)/not-found.tsx`
- API 路由统一捕获示例：`src/app/api/render/route.ts`、`src/app/api/director/pipeline/route.ts`、`src/app/api/director/stage/route.ts`
- 前端通用 API 客户端：`src/lib/api.ts`（fetch 失败统一抛 Error，带 data.error）

## 3. 架构与约定
- 错误分类流水线
  - 先检查是否已嵌入 WorkflowFault（schemaVersion=2），直接复用；
  - 再尝试 `projectProviderFault` 把 ProviderRequestError 映射到 PROVIDER_* 系列代码；
  - 然后 `classifyByType` 按 error.name 精确命中（ZodError、DirectorPreflightError、RouteContractError、RetryBudgetExhaustedError、ProviderUnavailableError 等）；
  - 接着 `classifyByMessage` 用有序正则匹配（额度、凭据、超时、队列、provider 等）；
  - 最后 `classifyByStage` 按 stage 给出 QUEUE/FABRICATE/RENDER/MEDIA_NARRATION 等兜底。
- 安全约束
  - message 由安全元数据生成，不包含响应正文、prompt、凭据或工具参数；原始 cause 仅保留在内存中，禁止序列化进节点/Artifact/task_attempts.failure；
  - UI 只展示类别与 digest/referenceId，完整错误留在服务端日志。
- HTTP 状态码约定
  - 400：请求体无效（zod.safeParse 失败）；
  - 401：未认证（UnauthenticatedError）；
  - 402：配额耗尽（QuotaExhaustedError，含 resetAt、billingUrl）；
  - 409：工作流执行失败（classifyWorkflowError 投影结果）；
  - 422：业务规则拒绝（如 SkipRejectedError）。
- 可重试性（retryable）
  - 外部服务抖动（PROVIDER_FAILED、QUEUE_FAILED、TASK_INTERRUPTED）标记可重试；
  - 配置/合同问题（CONFIGURATION_BLOCKED、ROUTE_CONTRACT_INVALID、QUOTA_EXHAUSTED）标记不可重试。

## 4. 约定与约束
- 所有出网调用必须通过 ProviderRequestError 包装，禁止直接透传第三方原始错误；
- 工作流各阶段 catch 后一律调用 `classifyWorkflowError(error, { stage })` 并返回 `{ ok, error, code }` 结构；
- 前端组件不得渲染 error.message/stack，仅显示 digest/referenceId 供支持对账；
- 401 响应统一转换为 UnauthenticatedError，由 `useRequireLogin().handleAuthError` 集中处理登录弹窗；
- Zod 校验失败统一归入 STAGE_INPUT_INVALID，提示具体字段路径但不泄露取值。

## 5. 典型使用位置
- API 路由：`src/app/api/render/route.ts`、`src/app/api/director/pipeline/route.ts`、`src/app/api/director/stage/route.ts` 均遵循 same try/catch → classifyWorkflowError → NextResponse.json 模式；
- 前端轮询：`src/lib/api.ts` 的 pollUntilDone/getJob/startRender 在 res.ok=false 时抛 Error(data?.error)；
- UI 错误边界：`global-error.tsx`、`products/(app)/error.tsx` 仅展示 digest，提供「返回首页/重试」操作。