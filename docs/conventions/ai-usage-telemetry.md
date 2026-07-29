# AI 调用账本与统计合同

本文是 Products 主应用 AI 调用事实、聚合与 UI 口径的唯一文字合同。Postgres
`ai_invocations` 是唯一调用账本，不从 `provider_dispatches` 或前端事件反推业务统计。

## 1. 范围与归属

- 覆盖 Director、视觉验收、TTS、ASR、自定义 OpenAI-compatible 端点与设置验证探测。
- 不覆盖营销页 `/api/engine/render` worker。
- workflow 调用把 `pipeline_runs.requested_by_user_id` 固化到
  `ai_invocations.actor_user_id`；重试、fallback、自动续接和后台领取不得改写发起人。
- 设置验证探测直接使用当前会话用户，`operation=credential-validation`。
- 工作台按实际发起账号跨 workspace 聚合；会员统计始终属于当前 workspace。

## 2. 一次真实调用

每次真实 Provider HTTP 出网对应一条 invocation。fallback 与重试各自记录；出网前失败
不进入调用量。生命周期固定为：

1. 解析授权、funding 与凭据；
2. 建账；managed 同事务预留额度；
3. 紧邻 fetch/stream 前标记 `provider_started_at`；
4. 用进程单调时钟计算 `provider_duration_ms`；
5. 成功按供应商真实 usage 结算；
6. 已出网但无可靠 usage 记录 `usage_status=unavailable`；
7. 未出网释放，且不进入调用量和成功率。

`funding` 仅为 `managed | byok | custom`。BYOK/custom 使用
`billing_status=not_applicable`，内部成本为空。不得用应用时间与数据库时间之差计算耗时。

## 3. 安全字段

账本允许 provider、model、capability、operation、source、安全失败类别、规范化 usage 与
时间数据。usage 使用版本化 JSON：

- text/vision：输入、缓存输入、输出、reasoning Token；
- TTS：输入字符与输出音频秒数；
- ASR：输入音频秒数与供应商返回 Token。

禁止保存 Prompt、消息正文、Tool 参数、凭据、原始供应商错误、隐藏推理。公共投影额外
禁止内部人民币成本、额度金额、单价、汇率、哈希与内部 ID。

## 4. `AiUsageProjectionV1`

公共投影包含：

- `coverage`：精确归属起点、是否包含旧 managed 历史、BYOK 历史是否缺失；
- `summary`：实际调用、成功/失败/进行中、成功率、已报告 Token、缓存 Token、
  TTS 字符、ASR 秒、P95 与最近调用；
- `series`：按请求 IANA 时区聚合的每日真实数据；
- `breakdown`：按 funding、provider、capability、operation 分组；
- `usageUnavailableCount`：供应商未报告 usage 的实际调用数。

成功率是成功终态除以全部已结束实际调用；running 不进入分母。P95 只使用 v2
`provider_duration_ms`，有效样本少于 2 时为 `null`。

## 5. 历史完整度

迁移持久化 `ai_invocation_v2` 切换时间。旧行只回填可信的
`funding=managed`、`telemetry_version=1` 与可从 usage 推导的 capability；不猜测旧
actor、duration 或 BYOK usage。会员周期仍可使用旧 managed 结算历史；账号投影只从
具有精确 `actor_user_id` 的 v2 行开始，并在 `coverage` 说明历史缺口。

## 6. 可视化

- 会员页面使用当前滚动 30 天周期的累计额度消耗阶梯线，数据仅来自 settled managed。
- 工作台使用 7/30 天每日调用堆叠柱，分段为“平台托管 / 自己的 API”。
- Token、字符与音频秒不得相加成伪总量。空、部分完整、失败状态均不得回退演示数字。
