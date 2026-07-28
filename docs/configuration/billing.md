# 平台会员与 AI 成本计量

本文是 PurpleInk 平台托管模型、会员额度与兑换码的运行合同。路由形状仍以
`docs/conventions/routing.md` 为准。

## 1. 会员方案

会员归属 workspace，不归属单个 user。所有方案使用滚动 30 天周期：

| plan | 内部 AI 成本池 | 可用平台 provider | 展示价格 |
| --- | ---: | --- | ---: |
| `free` | ¥10 | StepFun、MiMo | 免费 |
| `plus` | ¥50 | StepFun、MiMo、Gemini | ¥29/月 |
| `pro` | ¥200 | StepFun、MiMo、Gemini | ¥99/月 |
| `max` | ¥2,000 | StepFun、MiMo、Gemini | ¥599/月 |

内部金额以 CNY micros bigint 记账。公共页面与 API 只显示额度比例、方案与周期，
不得回显成本池金额、模型单价或记账汇率。

Max 只增加成本池，不引入独占模型、优先队列或更高并发。

## 2. 平台托管凭据

三家内置 provider 的 Key 只从以下 server-only 环境变量读取：

- `CVC_MANAGED_STEPFUN_API_KEY`
- `CVC_MANAGED_MIMO_API_KEY`
- `CVC_MANAGED_GEMINI_API_KEY`

这些变量不是 `provider_credentials` 的 fallback。内置平台模型始终走托管凭据；
OpenAI-compatible 自定义端点继续使用 workspace 加密凭据，且不消耗平台额度。

平台 Key 禁止进入数据库、客户端 bundle、HTTP/SSE、日志、Artifact、截图或错误文案。

## 3. 模型授权

可调用模型必须来自托管目录，并绑定不可变 rate card 版本。

- Free：StepFun、MiMo。
- Plus / Pro / Max：StepFun、MiMo、Gemini。
- fallback 必须先与当前会员允许集合求交集。
- 没有稳定公开价格的能力不得加入托管目录。

前端隐藏不可用模型只是体验优化；服务端必须在任何账本写入与外部调用前重新校验。

## 4. 记账

每次外部调用按 provider 返回的真实 usage 与调用时绑定的 rate card 结算：

- 文本/视觉：输入、缓存输入、输出 Token；
- TTS：字符或供应商明确的音频计费单位；
- ASR：实际音频时长或供应商明确的计费单位。

美元价格使用 rate card 冻结的人民币记账汇率。历史 invocation 永不随调价或汇率
变化重算。reasoning 已包含在 output 时不得重复计费。

调用前必须原子预留最大潜在成本；调用完成后释放差额并结算实际成本。厂商未返回
可靠 usage 时，托管调用按预留成本保守结算并标记 `usage_unavailable`。

额度不足时不得调用 provider、不得 fallback、不得自动重试，统一投影为
`quota_exhausted`。已提交 Artifact 不删除，pipeline 停在当前节点。

## 5. 兑换码

兑换码至少包含 128 bit CSPRNG 熵，数据库只存使用独立
`CVC_REDEMPTION_CODE_PEPPER` 计算的域分离 HMAC-SHA-256。

一个 Postgres transaction 必须同时完成幂等校验、一次性消费、会员更新、额度周期
建立与审计。无效、过期、撤销和已被其他 workspace 使用统一返回“兑换码无效或
不可用”，不得泄漏代码状态或归属。

同级码延长到期时间；高级码立即升级并开启新周期；低级码不能覆盖未到期的高级
会员，且拒绝时不消费代码。
