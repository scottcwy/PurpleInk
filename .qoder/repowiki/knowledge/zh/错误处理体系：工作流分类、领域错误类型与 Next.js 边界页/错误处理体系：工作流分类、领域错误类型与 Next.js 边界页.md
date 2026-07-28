---
kind: error_handling
name: 错误处理体系：工作流分类、领域错误类型与 Next.js 边界页
category: error_handling
scope:
    - '**'
source_files:
    - src/app/global-error.tsx
    - src/app/not-found.tsx
    - src/features/canvas/workflow-error.ts
    - src/features/ai/route-contract-error.ts
    - src/features/director/artifact-validation-error.ts
    - src/features/auth/errors.ts
    - src/features/auth/unauthenticated-error.ts
    - server/src/lib/error-message.ts
    - docs/conventions/workflow-failure-patterns.md
---

## 1. 系统与方法

仓库采用「领域错误类型 + 统一分类器 + Next.js 错误边界」的分层策略：
- 前端使用 Next.js 的 `global-error.tsx` 和 `not-found.tsx` 作为根级错误/404 边界，不暴露原始堆栈，仅显示类别与 digest。
- 业务链路（Director / 渲染 / 音频 / AI 路由）通过 `classifyWorkflowError` 把任意异常投影为统一的 `WorkflowErrorProjection`（code + stage + message + retryable），避免各阶段各自决定文案与是否可重试。
- 认证域使用结构化的 `AuthFailure` 对象配合 HTTP 状态码映射，避免泄露账号是否存在。
- 客户端未登录场景通过 `UnauthenticatedError` 类型在 API 调用层统一拦截并弹出登录框。
- 服务端对外错误文案通过 `errorMessage` 只取 `message`，不泄露 stack/路径等细节。

## 2. 关键文件与包

- `src/app/global-error.tsx` — Next.js 根级错误边界，兜底未捕获错误，展示 digest。
- `src/app/not-found.tsx` — 根级 404 页面，统一「不存在/无权访问」文案，防止信息泄露。
- `src/features/canvas/workflow-error.ts` — 工作流错误分类器，定义 `WorkflowErrorCode` 枚举与三段判定顺序（类型→文案→阶段）。
- `src/features/ai/route-contract-error.ts` — `RouteContractError` 类型，表示供应商/模型路由配置矛盾，不可重试。
- `src/features/director/artifact-validation-error.ts` — `ArtifactValidationError` 类型，上游产物校验失败。
- `src/features/auth/errors.ts` — 认证失败代码、HTTP 状态映射与消息集中管理。
- `src/features/auth/unauthenticated-error.ts` — 客户端可识别的未登录错误类型及 `throwIfUnauthenticated` 工具。
- `server/src/lib/error-message.ts` — 对外错误文案脱敏工具，仅返回 `message`。
- `docs/conventions/workflow-failure-patterns.md` — 工作流失败模式手册，记录已发生事故的规则与护栏。

## 3. 架构与约定

- **分类优先级**：`classifyWorkflowError` 严格按「类型优先于文案」的顺序判定。zod 合同错误、`ArtifactValidationError`、`RouteContractError`、`RetryBudgetExhaustedError` 等通过 `instanceof` 或 `error.name` 先命中，避免被文案规则误归到 `PROVIDER_FAILED` 等可重试类别。
- **retryable 语义**：内部矛盾（如路由配置矛盾、zod 校验失败）一律 `retryable=false`；外部抖动（网络超时、provider 5xx）才标记为可重试。这直接控制 UI 是否展示重试按钮以及 `recovery` 逻辑是否自动重排。
- **阶段兜底**：按 `stage` 字段回落到 `QUEUE_FAILED` / `FABRICATE_FAILED` / `RENDER_FAILED` / `MEDIA_FAILED` / `STAGE_FAILED`，禁止所有未识别错误都自称「渲染失败」。
- **安全脱敏**：所有面向用户的错误文案不得包含 provider 原始响应、prompt、凭据、隐藏推理或字段取值；zod 违规只暴露字段路径（最多 3 个）。
- **认证安全**：登录失败与验证码请求统一文案，不区分账号是否存在；邮件通道不可用返回 503 而非假装成功。
- **Next.js 边界**：`global-error.tsx` 自带 `html/body` 与样式，不依赖 Providers；`not-found.tsx` 统一 404 文案，避免泄露 workspace 存在性。

## 4. 约定与约束

- 新增错误来源必须先问「这是外部原因还是应用内部矛盾？」，内部矛盾必须 `retryable=false`，否则会导致 UI 展示无效的重试按钮。
- 跨阶段流动的数据结构只能有一个 zod 定义，任何 prompt 输入 schema 不得内联重写已有契约的子结构（见失败模式 A）。
- 对 Record/Map 类映射改动必须配全集遍历断言，防止节点类型 × 阶段矩阵漏覆盖（失败模式 C）。
- 读取异步媒体产物必须 `safeParse` 后给出明确的「尚未就绪」错误，归类为 `MEDIA_NOT_READY` 且 `retryable=true`（失败模式 D）。
- fixture 必须使用真实产物形状，最小对象仅用于反向断言（失败模式 E）。
- 改动 queue handler、stage runner、模型路由等长驻模块后，必须重启 dev server 再验证（失败模式 F）。
- artifact 指向的文件必须在生产者关闭后计算哈希，不得提前登记可变文件（失败模式 G）。
- 认证端点统一使用 `AUTH_FAILURE_STATUS` 映射 HTTP 状态，`authFailure()` 构造结构化失败对象，由调用方决定响应格式。
- 客户端 API 模块统一调用 `throwIfUnauthenticated(response)` 将 401 转为 `UnauthenticatedError`，由 `useRequireLogin().handleAuthError` 统一弹窗处理。
- 服务端对外错误一律通过 `errorMessage(err)` 脱敏，stack/绝对路径仅走 logger。
