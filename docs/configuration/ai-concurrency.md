# AI 分镜与供应商并发

本文记录 PurpleInk 生产调度真值。账号分镜并发和外部供应商调用池是两层独立限制，
不得用本机 Director lane、渲染并发或 RPM 互相代替。

## 1. 账号分镜槽

| 套餐 | 同账号活跃分镜上限 |
| --- | ---: |
| Free | 3 |
| Plus | 20 |
| Pro | 20 |
| Max | 50 |

- 上限按 workspace 共享，覆盖同账号的所有成员和项目。
- 同一分镜的文本、视觉、TTS、ASR 阶段复用一个 `work_unit_key`，不会重复占槽。
- 批量分镜按登记顺序每 500ms 开放一个启动窗口。
- 等待供应商时仍占分镜槽；完成、取消、跳过或终态失败后释放。
- `workflow_concurrency_leases` 是持久化真值；活动租约 20 分钟，进程退出后可过期回收。
- BYOK 不进入托管供应商池，但仍遵守本层套餐上限。

设置页的套餐上限只读。普通设置 API 只接受
`laneQuotas.renderShotConcurrency`；Director 进程并发只能由运维配置，渲染并发与 AI
分镜并发分别展示。

## 2. 托管供应商池

| 池 | 合同 RPM | 正常目标 | 60 秒硬线 | 最小发送间隔 |
| --- | ---: | ---: | ---: | ---: |
| `managed:gemini` | 1000 | 750 | 900 | 80–88ms |
| `managed:stepfun` | 200 | 150 | 180 | 400–440ms |
| `managed:mimo` | 100 | 75 | 90 | 800–880ms |

三池复用 `provider-dispatch.ts`，但调用记录、冷却、发送节奏和在途上限完全隔离。托管
scope 只由 provider 决定，轮换平台 Key 不会得到新额度池。BYOK scope 由
`workspace + provider + credential fingerprint` 决定，不消耗托管 RPM。

`provider_dispatches` 保存滚动窗口和真实在途租约，`provider_dispatch_cooldowns` 保存
429 冷却，`provider_pool_states` 保存自适应在途数。所有发送许可在 PostgreSQL advisory
lock 内原子判定。

## 3. 自适应在途与恢复

- 托管池从 8 个在途开始，最高 50。
- 最近窗口至少完成 20 次且连续 5 分钟稳定，才增加 1。
- 真实 429 立即暂停该 scope 并把在途上限降 25%。
- 503、网络或超时样本率超过 2% 时同样降 25%。
- 优先使用 `Retry-After`；缺失时按 2、4、8、16、30 秒退避并增加随机错峰。
- 调度器发送前发现的 pacing/RPM/并发等待复用原 attempt，仅推迟 `visible_at`。
- 只有供应商真实返回 429 时才创建延迟恢复 attempt；累计等待上限 15 分钟。

供应商机会按实际发起用户轮转。同一用户刚获得许可且已有其他用户等待时会短暂让出；
只剩一个用户时可以使用全部可用能力。套餐只改变账号可同时工作的分镜数，不购买供应商
插队权。

## 4. 运维覆盖

可用以下 server-only 环境变量覆盖硬保护线或初始在途数：

```text
GEMINI_RPM_LIMIT
GEMINI_CONCURRENCY_LIMIT
GEMINI_TPM_LIMIT
STEPFUN_RPM_LIMIT
STEPFUN_CONCURRENCY_LIMIT
STEPFUN_TPM_LIMIT
MIMO_RPM_LIMIT
MIMO_CONCURRENCY_LIMIT
MIMO_TPM_LIMIT
AI_PROVIDER_POOL_MODE
AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT
```

供应商额度覆盖值必须为正整数。发送间隔和最高在途数由代码策略保守固定；提升合同额度时
应同时更新策略、压力测试和本文，不得只把本机 Director lane 调大。

`AI_PROVIDER_POOL_MODE=shadow` 时，调度器仍登记真实调用并返回
`shadowWaitReason`，但不因供应商窗口阻断请求；观察完成后必须将托管池一次性切换到
`enforce`。全局硬池不能按用户百分比绕过，否则未拦截流量会破坏 RPM 保护。

`AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT` 接受 0–100：0 为账号层影子模式，10、50、
100 对应正式发布阶段。workspace 使用稳定分桶，同一账号不会在请求间反复切换实验组。
无效值按 100 处理，避免配置错误意外关闭保护。

推荐发布顺序：

1. 执行 migration 后用 `AI_PROVIDER_POOL_MODE=shadow` 和账号 0% 观察决策与容量。
2. 确认统计后将供应商池全局切换为 `enforce`，账号层设为 10%。
3. 监控 429、等待时长、数据库 p95 和租约回收，再依次提升账号层到 50%、100%。

## 5. 安全投影

客户端只可看到当前账号的套餐上限、活跃分镜数、等待数、供应商标签和预计恢复时间。
不得返回全平台调用量、其他用户身份、凭据指纹、Prompt、原始供应商错误或内部调度参数。
