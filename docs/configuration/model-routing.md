# 模型路由：熔断与备选降级

本文覆盖 Director 模型路由在 provider 故障时的两道容灾机制（模式 H 阶段 4）：
进程内熔断器与显式备选降级链。路由本身的真值顺序（DB 路由 > env > 代码默认）
与能力矩阵见 `docs/conventions/routing.md`。

## 熔断器（无需配置）

`src/features/ai/provider-breaker.ts`，按 provider 独立计数：

- 连续外部失败 ≥3 次 → 该 provider 熔断 open **5 分钟**，期间路由解析直接拒绝；
- 窗口过后进入 half-open，只放行**一次**试探调用：成功即恢复（close），
  失败重新 open 一整个窗口；
- 只有真实发生过的外部模型调用成败才计入（记账收敛点在
  `pi-session.ts` 的 run 结果处）；路由/能力矛盾（`RouteContractError`）等
  内部错误不计入，一条配置错误不会把健康的 provider 熏成不可用。

限制：熔断状态纯内存（单实例假设，globalThis 锚定防 dev HMR 清零），
重启进程即复位；多实例部署必须先落库，否则每个实例各自试探，熔断形同虚设。

## 备选 provider（默认关闭，需显式配置）

每个内置 provider 的资金来源独立存于 `workspace_settings`：
`ai.funding.stepfun`、`ai.funding.mimo`、`ai.funding.gemini`。缺行默认
`managed`。路由只决定 provider/model，资金来源不能由路由请求覆盖。

- `managed` 按套餐目录授权并进入成本池；
- `byok` 仍校验服务端模型目录与能力，但跳过套餐门禁和平台账本；
- fallback 沿用备选 provider 自己已保存的来源，禁止在 BYOK 与 managed 之间
  自动切换。

主 provider 熔断 open 时的降级出路，**默认无备选**——未配置时只会得到
「AI 服务暂时不可用，可稍后重试或选择跳过」的可重试失败
（`PROVIDER_FAILED`），绝不擅自替用户换模型。

配置方式：`POST /api/settings` 提交 `fallbackProvider` 字段：

```jsonc
{ "fallbackProvider": "stepfun" }   // 设置备选
{ "fallbackProvider": null }        // 清空备选（回到默认）
```

规则：

- 备选必须支持文本会话（Director 会话一律走文本域）；纯音频端点
  （`openai-compatible-tts` / `openai-compatible-asr`）返回 422 不落库。
- 存储在 `workspace_settings` 的 `ai.fallback-provider`
  （`src/features/ai/fallback-provider-store.ts`）。
- 切换条件：主选熔断 open，且备选 ≠ 主选、备选自身未熔断、备选已配置
  API Key。任一不满足即抛 `PROVIDER_FAILED`（可重试），不回显 provider
  原始错误。
- 降级使用备选 provider 的**默认模型推导**（`providerDefaults().modelFor`，
  与设置页展示同源），不复用主选路由行里的模型名。

## 降级的可观测口径

设置页展示的始终是**配置真值**（用户选的主选），不随一次降级改口；
降级发生时的执行真值通过三处如实留痕：

1. `resolveDirectorModelTarget` 返回值的 `degradedFrom` 字段
   （仅降级时存在，记录被熔断的主选）；
2. 会话 routeLabel 带备选标注（如 `stepfun/step-3.5-flash（备选，主选
   gemini 已熔断）`），随失败落入 attempt.failure，UI 错误链路可追溯；
3. 服务端日志 `[ai] provider_fallback { from, to }`。
