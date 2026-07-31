# 模型路由、熔断与部署回退

本文说明 Director 如何从工作板块选择解析出唯一的 `ExecutionPlan`。模型、渠道、
协议与部署真值来自 `config/ai-catalog.yaml`；路由语义以
`docs/conventions/routing.md` 为准。

## 1. 固定解析链

```text
工作板块
  → 工作区已有模型选择
  → Managed / BYOK 资金来源
  → 套餐权限或 BYOK 凭据
  → Deployment
  → ExecutionPlan
  → 工作区并发许可 + 渠道并发许可
  → outbound attempt
```

业务代码不得根据模型字符串前缀推断供应商、价格、能力或协议。五家内置供应商的
模型调用都经过同一个内置部署解析器；自定义 OpenAI-compatible 保留独立且明确的
用户配置边界。

## 2. 资金来源

五家内置 provider 的来源分别存于：

- `ai.funding.stepfun`
- `ai.funding.mimo`
- `ai.funding.gemini`
- `ai.funding.openai`
- `ai.funding.anthropic`

缺行默认 `managed`。路由只决定 provider/model，单次请求不能覆盖资金来源。

- Managed：按 usage period 冻结的套餐权限进入平台渠道，并扣 Managed 权益。
- BYOK：使用当前工作区加密凭据和目录固定的官方 URL，不扣 Managed 权益。
- Managed 与 BYOK 不因鉴权、限流、超时或不可用而相互回退。

## 3. 熔断器

`src/features/ai/provider-breaker.ts` 按 provider 独立计数：

- 连续外部失败达到阈值后熔断；
- 窗口结束进入 half-open，只允许一次探测；
- 只有真实 outbound 结果计数，路由合同错误不污染 provider 健康状态；
- 状态当前为单进程内存状态，进程重启会复位。

熔断打开时返回脱敏的可重试错误，不切换到另一家供应商，也不切换资金来源。

## 4. 唯一自动回退

只有 Managed Gemini 的同渠道部署允许自动回退：

1. 主部署 `gemini.3.6-flash.managed`。
2. 遇到明确限流、上游临时不可用、网络连接失败或硬超时时，
   最多再执行一次 `gemini.3.1-flash-lite.managed`。

鉴权错误、配置错误、套餐/额度不足、请求合同错误、内容策略与业务验证错误均不回退。
BYOK Gemini 不继承该回退。

主调用与回退调用各自创建独立 invocation/dispatch ticket，分别保存实际部署、
模型、价格卡、usage 与失败分类。适配器内部不得隐藏自动重试。

## 5. 并发

真实请求必须同时获得工作区套餐许可与渠道许可。任一获取失败都不能发送请求。
渠道 429 只影响自己的失败域，并按 `Retry-After` 自适应降速。

工作区并发来自 usage period 的套餐快照：Free 3、Plus 20、Pro 50、Max 100。
Gemini BCAI、OpenRouter 和 XhuoAI Managed 渠道各自最多 200 个在途请求；
BYOK 按 `workspace + provider` 建立独立失败域。

## 6. 可观测性

设置页展示配置真值，不根据某次调用结果修改用户选择。运行真值记录在：

- `ExecutionPlan`：资金来源、逻辑模型、实际模型、部署、渠道、协议和价格身份；
- invocation：每次 outbound attempt 的开始、成功或脱敏失败；
- reservation / 双账本：预占、官方参考成本、权益扣减与释放；
- workflow 父记录：只聚合子调用，不额外扣费。

## 7. `ResolvedExecutionPlanV2` 唯一合同

attempt 开始执行时只解析一次不可变计划。内置与自定义端点使用
`kind: built-in | custom` 判别联合，并完整冻结：`logicalModelId`、
`outboundModelId`、`deploymentId`、`channelId`、`adapterId`、
`officialPriceIdentity`、`providerPoolId`、`failureDomainId`、`funding`、
`capability` 与路由策略版本。

- 授权消费逻辑模型，HTTP 适配器消费出网模型，计费消费官方价格身份，调度消费
  provider pool 与 failure domain；禁止继续传递语义模糊的 `model`。
- Director、Vision、TTS、ASR 与 worker 网关不得在 attempt 内重新查询路由、凭据、
  价格或并发池。配置变化只影响新 attempt。
- Gemini 3.6 → 3.1 是计划内同渠道子部署；每次真实出网各建一条 invocation，复用
  attempt 与凭据版本，但保留独立部署和价格身份。
- 路由未授权、配置错误与确定性凭据错误零自动重试；容量等待进入调度票据，不改写
  为 Provider 失败。
