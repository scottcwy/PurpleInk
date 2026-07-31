# 平台会员与 AI 计费

本文是 PurpleInk 套餐、Managed 模型参考成本、用户权益和兑换码的运行合同。
静态真值来自 `config/billing-catalog.yaml` 与 `config/plans.yaml`，经确定性生成器
生成类型安全 manifest；Postgres 保存动态状态与不可变历史。

## 1. 套餐权益

会员归属 workspace。每个 usage period 在创建时冻结套餐版本、额度、并发和
Managed provider 权限，后续配置更新不得改写历史周期。

| plan | 额度 | 工作区并发 | Managed provider |
| --- | ---: | ---: | --- |
| `free` | ¥10 等值 | 3 | StepFun、MiMo |
| `plus` | ¥50 等值 | 20 | StepFun、MiMo、Gemini |
| `pro` | ¥200 等值 | 50 | 五家 |
| `max` | ¥2,000 等值 | 100 | 五家 |

五家经过验证的 BYOK 均可使用，不受 Managed provider 权限限制，但仍受工作区
并发、安全、内容与审计规则约束。升级套餐创建或切换到新权益版本，不修改旧快照。

## 2. 定价真值

中转渠道只负责执行，不参与定价。Managed 调用始终按逻辑模型对应的官方公开价格
计算参考成本，不记录 BCAI、OpenRouter、XhuoAI 等渠道的采购价。

每张 rate card 保存：

- 唯一版本、官方价格身份和币种；
- `sourceUrl`、`retrievedAt`、`effectiveFrom`、可选 `effectiveTo`；
- token、缓存 token、字符或音频时长的整数微单位价格；
- 适用的上下文阶梯、促销区间和汇率版本。

价格变化只能新增 rate card。已被 invocation 使用的卡不可修改；促销卡必须有
结束时间与后续卡；生效区间重叠会被目录校验拒绝。美元通过版本化内部汇率换算，
请求期间不访问实时汇率服务。

所有结算使用 BigInt 整数微单位和有理数倍率，禁止浮点数直接结算。初始 Billable
Service 倍率为 1.0，但仍作为独立版本保存。

## 3. 双账本

每次 Managed outbound attempt 产生两类记录：

1. 官方参考成本账：官方价格身份、usage、价格卡、原币金额、汇率、CNY micros
   和 `reported | estimated | uncertain` 计量质量。
2. 用户权益账：参考成本乘以调用时冻结的服务倍率，表示实际套餐额度扣减。

BYOK 保存 invocation 与脱敏 usage 审计，但不生成 Managed 官方参考成本结算，
也不扣用户 Managed 权益。工作流父记录只聚合子调用，绝不额外扣费。

历史价格、汇率、套餐快照与已结算调用永不重新计算。

## 4. 预占与结算

Managed 调用顺序固定为：

1. 解析不可变 `ExecutionPlan` 与生效价格卡。
2. 根据最大输出计算预占。
3. 在数据库事务内锁定 usage period 并创建 reservation。
4. 同时取得工作区并发许可和渠道并发许可。
5. 创建 invocation attempt 后才发送真实请求。
6. 标准化 usage，写官方参考成本账与用户权益账。
7. 幂等结算并释放多余预占。
8. 释放两层并发许可。

失败语义：

- 未发送：全额释放，不产生调用成本；
- 已发送但明确无 usage：释放权益，保留失败 attempt；
- 成功但上游无 usage：确定性估算并标记 `estimated`，不得静默记零；
- 硬超时且状态未知：标记 `uncertain`，不直接扣权益并产生告警；
- 已结算幂等键不得再次扣费；
- 队列重试和 Gemini 部署回退各自创建可审计 attempt。

额度不足时不得发出 provider 请求，也不得通过回退或重试绕过额度。

## 5. 并发与渠道池

真实请求必须同时持有 usage period 中冻结的工作区并发许可，以及目录声明的渠道
并发许可。BCAI、OpenRouter、XhuoAI Managed 池分别最多 200 个在途请求；
Step Plan 与 MiMo 使用自己的独立目录限制；BYOK 使用 `workspace + provider`
独立失败域。200 不是 RPM/TPM 推导值。

429 只调整对应渠道，读取 `Retry-After` 自适应降速，不阻塞其他 provider。

## 6. 平台凭据

五家 Managed Key 只来自 server-only 环境：

- `CVC_MANAGED_STEPFUN_API_KEY`
- `CVC_MANAGED_MIMO_API_KEY`
- `CVC_MANAGED_GEMINI_API_KEY`
- `CVC_MANAGED_OPENAI_API_KEY`
- `CVC_MANAGED_ANTHROPIC_API_KEY`

它们不是 `provider_credentials` 的 fallback。Managed 与 BYOK 不交叉回退，平台
Key 禁止进入数据库、客户端、HTTP/SSE、日志、Artifact、截图或错误文案。

## 7. 兑换码

兑换码至少包含 128 bit CSPRNG 熵，数据库只存使用独立
`CVC_REDEMPTION_CODE_PEPPER` 计算的域分离 HMAC-SHA-256。

一个 Postgres transaction 必须同时完成幂等校验、一次性消费、会员更新、usage
period 建立与审计。无效、过期、撤销和已被其他 workspace 使用统一返回
“兑换码无效或不可用”，不得泄漏代码状态或归属。

同级码延长到期时间；高级码立即升级并开启新周期；低级码不能覆盖未到期的高级
会员，且拒绝时不消费代码。
