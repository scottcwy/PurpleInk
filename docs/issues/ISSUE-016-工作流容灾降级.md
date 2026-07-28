> **2026-07-29 运行时补充结论（当前口径）**
>
> 本文原终审把「心跳/claim/超时竞态」判为安全，但真实 FABRICATE 端测证明该结论
> 不完整：外部模型调用可能长于短租约，进程内心跳一旦没有覆盖完整调用窗口，
> attempt 会被误收尸，并遗留 `ai_invocations.running/reserved`。现已补齐三条边界：
> Provider 调用 4 分钟硬超时且禁用 SDK 内重试；租约按任务 kind 覆盖完整执行上限
> 加一次清扫间隔；每轮 sweep 幂等结算父 attempt 已终态的孤儿预留。复发模式与
> 提交前检查以 `docs/conventions/workflow-failure-patterns.md` 模式 I/J 为准。

总结：
收到，UI 端测由您自行验证。我将任务 10 收尾并立即启动任务 11 终审：并行派出 3 名独立评审，各自只负责一个维度。
三名评审（Mark 完整性、Ryan 正确性、Kim 影响面）已并行开始终审，全部完成后我会合并去重输出按严重度分组的评审结论。正确性评审已完成，发现 1 个需修复的并发抢写问题；等 Kim（影响面）与 Mark（完整性）的结果到齐后统一合并处置。完整性评审通过、无缺口；还差 Kim 的影响面评审，到齐后统一合并处置。收到——终审结束后我将只输出一份详细的合并评审报告（含 Ryan 已发现的并发抢写问题），不自动派发修复，由您决定后续处置。目前等待 Kim 的影响面评审完成。
三维度终审全部完成。以下是合并去重后的详细终审报告与整体交付总结。

---

# 容灾降级机制 · 终审报告

## 一、终审结论总览

| 维度 | 评审人 | 结论 |
|---|---|---|
| 完整性（需求覆盖） | Mark | **通过**：五大需求条目（租约/重试/跳过/熔断/文档测试）全部落地并有测试锁定，阻断与建议级缺口均为零 |
| 正确性（逻辑/并发/安全） | Ryan | **1 个阻断级问题**（并发抢写），其余方向（事务边界、状态机、时钟计数、安全红线、分类规则顺序）逐条核实无问题 |
| 影响面（既有功能回归） | Kim | **无阻断级回归**；2 个中危行为变化需处置，2 个低危建议；7 个高风险方向（迁移安全、skipped 全消费方、路由等价性、git 卫生等）逐条核实安全 |

## 二、问题清单（合并去重，按严重度）

### 阻断级 — 建议尽快修复

**P1：sweep 僵尸回收与迟到的 handler 完成存在抢写**
- 位置：[attempt-completion.ts](file:///d:/projects/Dev-Tools/PurpleInk-dev/src/lib/queue/attempt-completion.ts) 的 `completeAttempt` 按 id 锁行但**不校验当前 status 是否仍为 running**。
- 场景：attempt 租约过期被 [sweepExpiredLeases](file:///d:/projects/Dev-Tools/PurpleInk-dev/src/lib/queue/lease.ts) 终态化为"租约过期回收"后，原进程中挂起的 handler 迟到完成，会再次覆盖写 attempt/run 终态——导致 DB 里显示"正常成功/失败"而节点投影是 TASK_INTERRUPTED，两边矛盾；还会污染重试预算的失败计数。
- 修法（评审已给出，改动很小）：`completeAttempt` 事务内加读 status，非 `running` 即视为陈旧完成直接 no-op；`scheduleRetry` 的 UPDATE 同步带 `status='running'` 条件。

### 中危 — 应修/需决策

**P2：导出任务执行超时语义收紧（10 分钟 vs 30 分钟）**
- 阶段 1 的按 kind 超时表未给 `export-project` 显式条目，落入默认 10 分钟；而 [export-queue-handler.ts](file:///d:/projects/Dev-Tools/PurpleInk-dev/src/features/render/export-queue-handler.ts) 的轮询上限与注释承诺是 30 分钟。长片拼接超过 10 分钟会被队列侧误杀。
- 修法：超时表显式加 `export-project: 30min`（如需长配音，`media-narration` 一并声明），并同步注释。

**P3：自动重试扩增外部调用次数（行为扩展，需确认而非 bug）**
- 可重试失败现在会后台自动重跑最多 2 次，外部模型/TTS 调用与计费随之增加，打破"点一次只调一次"的旧隐含假设。
- 处置选项：接受并在文档/设置页明示；或对计费敏感的 handler 显式传 `allowAutoRetry:false`。

### 低危 — 建议

**P4：skipped 的语义分层需要 UI 文案支撑**——流水线层 skipped 视为终态、导出层视为"不完整需降级占位"，设计合理但建议在导出 readiness 界面对 skipped 节点标注"已跳过，导出为降级版本"，避免用户误读为失败。

**P5：TASK_INTERRUPTED 新类别的用户说明**——建议失败弹窗补一句解释"这是系统回收僵尸任务的保护机制，可放心重试"。

## 三、已核实安全的关键方向（三评审交叉确认）

- **迁移安全**：`visible_at` 默认 now() 回填存量行，旧任务可正常领取；sweep 显式要求 `lease_expires_at IS NOT NULL`，不误伤存量数据；0006 CHECK 变更不重写表数据。
- **skipped 全消费方覆盖**：DB 约束、类型、状态机、status-bus、advance/完成度、导出 readiness、UI 组件全部显式处理，无漏网 switch/Record。
- **心跳/claim/超时竞态**：行锁语义保证"刚续租不会被回收"；执行超时不会产生二次 completeAttempt；heldAttempts 清理无泄漏。
- **错误分类**：三个新码的 MESSAGE_RULES 只匹配新增固定报文且排在笼统规则之前，不会抢走旧报文类别（模式 B/D 护栏满足）。
- **路由等价性**：熔断未触发时模型路由与旧版严格等价；备选降级默认关闭、三层校验（schema/能力/熔断），设置 API 向后兼容。
- **安全红线**：失败文案不泄 provider 原始错误/prompt/凭据；skipReason 仅入审计不回显；fallback provider id 无注入面。
- **Git 卫生**：5 个 commit 无夹带 auth 代码或 .qoder/**；routing.md 现状同时正确包含他人 auth 修复与本次 skip 合同段落。

## 四、整体交付总结

**提交清单**（yusheng/two-part-merge，均未 push）：
- `5f60d48` 阶段1：租约 + 僵尸回收 + 执行超时 + 并发 clamp
- `d2cecfe` 阶段2：自动重试退避 + 30 分钟窗口 5 次预算闸门
- `aa8a606` 修复：sweep 节点投影补 workspace 上下文（根因是他人 a25d3c3 引入的上下文改造）
- `f66d192` 阶段3：skipped 一等状态 + 手动跳过 + 降级导出接线 + 文档
- `be3df80` 阶段4：Provider 熔断 + 显式备选降级链

**验证证据**：各阶段 lint/typecheck/test（921 用例）/test:pg（134 用例、迁移连跑两次）/verify:v3/build 全绿；QA 真实环境验证——跳过全链路（API+DB+哈希一致+下游推进+422 反向）、重试预算 409 阻断、僵尸回收 live sweep（重启后实测 TASK_INTERRUPTED 投影正确）均 PASS，证据在 `.data/resilience-e2e/`。

**遗留事项**：
1. P1 并发抢写修复（改动小，建议下一个 commit 处理）；P2 超时表补条目可与 P1 同批。
2. 画布 UI 人工端测由您自行进行（browser-use 的 Chromium 与 Next 16 Turbopack hydration 不兼容，组件级测试已全覆盖）；验证时注意先重启 dev server（模式 F）。
3. P3 自动重试的计费影响需要您拍板：接受默认开启，还是对特定阶段关闭。

——————

下面是审查记录：
完整性（需求覆盖） [Perspective] completeness
Critical Issues (MUST FIX)
暂无发现完整性维度上的阻断级缺口。所有基线需求条目在代码、文档与测试中均有对应落地，且关键行为均被测试锁定。
Warnings (SHOULD FIX)
暂无发现完整性维度上的警告级缺口。
Suggestions (CONSIDER)
下面按你给出的五大需求条目，分别给出「已覆盖 / 部分覆盖 / 未覆盖」结论，并标注主要证据文件。最后总结完整性缺口清单（目前为空）。
1. 租约：claim 写租约、心跳续本进程持有、sweep 回收、启动即扫+60s 周期、按 kind 执行超时、并发 clamp 1..8
结论：已覆盖覆盖点与证据：
claim 写租约 & 只领 visibleAt ≤ now 的 queued attempt
代码：src/lib/queue/in-process-queue.ts（claim()）
Schema：src/lib/db/schema/execution.ts 中 task_attempts.leaseExpiresAt / visibleAt 字段
测试：src/lib/queue/lease.pg.test.ts（验证 claim 时写入租约截止时间）
心跳只续本进程持有的租约
代码：src/lib/queue/lease.ts 中 renewLeases(db, attemptIds) 只对传入 attemptIds（由本进程持有）续租
队列心跳：src/lib/queue/in-process-queue.ts 中 heartbeat() 针对当前进程所 claim 的 attempts 调用 renewLeases
测试：src/lib/queue/lease.test.ts / in-process-queue.test.ts 中心跳节奏和续租对象的验证
sweep 过期回收（attempt/run/节点三处一致）
代码：src/lib/queue/lease.ts 中 sweepExpiredLeases(db)
在事务内选取 status='running' 且 leaseExpiresAt<now() 的 attempts（for update skip locked）
将这些 attempts 标记为 failed，对应 pipeline_runs 也置 failed
事务外调用节点投影（projectInterruptedNodes / transitionNodeStatus / recordStageError）将节点置为 failed 并写 stage error
测试：src/lib/queue/lease.pg.test.ts
验证过期 attempt 收尸为 failed（attempt+run），节点 status=failed，stage error code=TASK_INTERRUPTED，message 为“执行进程中断，任务已自动回收，可重试”
验证节点不再 running 时 sweep 容错，不会错误地改成功节点状态
启动即扫 + 60s 周期
代码：src/lib/queue/in-process-queue.ts 中 start()
启动时立即调用一次 sweepExpiredLeases
使用定时器每 SWEEP_INTERVAL_MS = 60_000 触发 sweep
常量：src/lib/queue/lease.ts 中 SWEEP_INTERVAL_MS = 60_000
测试：in-process-queue.test.ts 中对启动即扫与周期性的行为验证
按 kind 执行超时（10 / 15 / 10min）
代码：src/lib/queue/lease.ts
EXECUTION_TIMEOUT_MS 显式为 'director-stage' → 10 分钟，'render-shot' → 15 分钟
DEFAULT_EXECUTION_TIMEOUT_MS = 10min，其它 kind 走兜底的 10 分钟（满足 export 10min 要求）
withExecutionTimeout(kind, task) 通过 Promise.race 包裹 handler，超时后抛出专门错误，并避免迟到 rejection 变成 unhandled
测试：src/lib/queue/lease.test.ts 对不同 kind 的超时行为和常量进行锁定
并发推导 clamp 1..8
代码：src/lib/queue/in-process-queue.ts 中 defaultRenderShotConcurrency()
使用 os.availableParallelism() 推导并发度
对结果进行 clamp，确保在 [1, 8] 区间
测试：src/lib/queue/in-process-queue.test.ts 中对 1..8 边界行为的验证
需求条目状态：
claim 写租约：已覆盖
心跳只续本进程持有：已覆盖
sweep 三处一致 & 启动即扫+60s：已覆盖
kind 维度执行超时 10/15/10min：已覆盖
并发推导并 clamp 1..8：已覆盖
2. 重试：自动重试退避 + 重试预算闸门 + 文案出口指引
结论：已覆盖覆盖点与证据：
可重试失败自动重试（superseded + attemptNo+1 + visibleAt 退避，最多 2 次）
代码：src/lib/queue/retry-policy.ts & attempt-completion.ts
MAX_AUTO_RETRIES = 2
backoffMs(attemptNo)：基值 BASE_RETRY_DELAY_MS = 5000，指数退避 5000 * 2^attemptNo，再加 ±20% 抖动
shouldAutoRetry(message, attemptNo, stage)：结合 classifyWorkflowError 的 retryable 标志，且 attemptNo>2 一律不自动重试
completeAttempt(...)：在失败且 shouldAutoRetry 返回 true 时：
原 attempt 标记 superseded
插入新 attempt：attemptNo+1，status='queued'，visibleAt = now() + backoffMs(attemptNo)
run 状态回滚到 queued
对节点调用 resetNodeForRetry → 状态复位为 pending（属于 queued/pending 路径）
测试：src/lib/queue/attempt-completion.pg.test.ts 验证 superseded → 新 attempt 退避可见时间、节点复位及 run 状态变化
不可重试直接终态
代码：attempt-completion.ts 中对 shouldAutoRetry 返回 false 的路径直接将 attempt/run 终态化
测试：attempt-completion.pg.test.ts 中对 CONFIGURATION_BLOCKED 等不可重试错误不追加 attempt 的用例
Fingerprint 30min 窗口 5 次预算闸门（覆盖 director & render 两条入队）
代码：src/lib/queue/retry-policy.ts
RETRY_WINDOW_MS = 30min
MAX_FAILURES_IN_WINDOW = 5
countRecentFailures(db, workspaceId, fingerprint) 按窗口和 fingerprint 统计失败次数
assertEnqueueRetryBudget(kind, payload) 在入队前检查预算，超出则抛 RetryBudgetExhaustedError
入队接线：
director：src/features/director/queue-handler.ts 中 enqueueDirectorStage 默认注入 assertRetryBudget: assertEnqueueRetryBudget，在 transitionNodeStatus => assertRetryBudget => enqueue 链路中调用
render：src/features/render/queue-handler.ts 中 enqueueRenderShot 同样在入队前调用 assertRetryBudget('render-shot', payload)
测试：
src/lib/queue/retry-policy.pg.test.ts：验证 30min 窗口 5 次失败后再次入队触发闸门
src/features/director/queue-handler.test.ts & src/features/render/queue-handler.test.ts：验证闸门触发时节点状态和错误投影（RETRY_BUDGET_EXHAUSTED）
RETRY_BUDGET_EXHAUSTED 文案与 retryable=false，含“跳过”出口指引
代码：src/features/canvas/workflow-error.ts
为 RETRY_BUDGET_EXHAUSTED 定义固定投影：retryable=false
message 形如“该环节在 30 分钟内已失败 5 次，已暂停重试；可稍后再试、修复配置或选择跳过”
明确包含“选择跳过”出口指引
MESSAGE_RULES 中有针对预算耗尽文案的匹配，确保归入该类别
测试：workflow-error.test.ts 中锁定 REPRO 文案与 retryable=false 的分类结果
需求条目状态：
自动重试退避 5s·2^n±20%、上限 2 次：已覆盖
不可重试直接终态：已覆盖
指纹 30min 窗口 5 次预算闸门覆盖 director & render 入队：已覆盖
RETRY_BUDGET_EXHAUSTED retryable=false 且文案含“跳过”出口指引：已覆盖
3. 跳过：三类节点、skipped 一等状态、skipMeta & artifact 留痕、下游推进 &降级导出、API & UI & 反悔
结论：已覆盖覆盖点与证据：
仅 shot-codegen / shot-sfx / shot-subtitle 可跳过 + 全集遍历断言
代码：src/features/director/skip-policy.ts
SKIPPABLE: Record<CanvasNodeType, boolean> 中只对上述三种为 true
SKIPPABLE_FROM_STATUSES = ['failed','stale','cancelled']
测试：skip-policy.test.ts
遍历 CANVAS_NODE_TYPES，确保只有这三种为 skippable
验证只有来自 failed/stale/cancelled 状态允许跳过
skipped 一等状态（迁移+状态机+持久化映射）
Schema：src/lib/db/schema/canvas.ts 中 NODE_STATUSES 引入 'skipped'，并更新 check 约束
状态机：src/features/canvas/status.ts
ALLOWED_TRANSITIONS 中支持 failed/cancelled/stale → skipped，skipped → pending
在进入 skipped 时写 skipMeta；在离开 skipped（→pending）时移除 skipMeta
测试：status.test.ts 中验证所有合法/非法状态组合，包括 skipped 一等状态的持久化行为
skipMeta 留痕
代码：status.ts 中 resolveTransitionData 对 skipped 转移写入 data.payload.skipMeta = { reason, at }
跳过流程：src/features/director/skip.ts 在成功跳过后调用 transitionNodeStatus(nodeId,'skipped',{ skipMeta })
测试：skip.pg.test.ts / status.test.ts 验证 skipMeta 写入与读取
node-skip-marker 真字节真哈希
代码：skip.ts 中 registerSkipMarker(...)
将 marker JSON 写入 storage（node-skip/${projectId}/${nodeId}.json）
再读回实际 bytes，计算 SHA-256 contentHash
调 commitArtifactRecord 登记 artifact：kind='node-skip-marker'，sizeBytes 与 contentHash 来自真实字节
测试：skip.pg.test.ts 使用内存 storage 验证：
artifact kind='node-skip-marker'
contentHash 与存储文件内容一致，marker JSON 中含 schemaVersion、projectId、nodeId、nodeType、reason
下游推进（areAllUpstreams / listCompleted）将 skipped 视作占位完成
代码：src/features/director/advance-repository.ts / advance.ts
对 areAllUpstreamsSuccessful / listCompletedNodeIds / isProjectComplete 的实现中，将 skipped 视为满足前置
测试：advance.test.ts
验证 upstreamSkipped/skipped + upstreamSucceeded/succeeded 时 downsteam 可执行
upstream failed 时不满足前置条件
降级导出把 skipped lane 归入占位
代码：src/features/render/media-assembly.ts / export-service.ts
测试：
media-assembly.test.ts：在 degraded=true 情况：
skipped lane 生成 placeholderCandidates（laneKey、durationInFrames、needsVideo 等）
在存在 placeholderVideos 时，将 lane 用黑场视频占位，字幕/旁白按实际产出配置
export-service.test.ts：getExportReadiness 在 degraded 模式下对 skipped lane 给出 placeholderCandidateLanes 与 degradedReady=true，符合占位导出合同
API：intent=skip & skipReason 1–200 必填 & 422 分支
代码：src/app/api/director/stage/route.ts
request schema：intent 枚举包括 'skip'；skipReason trim 后长度 1–200
refine：intent='skip' 时 skipReason 必填；非 skip intent 不允许附带 skipReason
handler：intent='skip' 调用 skipNodeAction；捕获 SkipRejectedError 映射 422 + code='SKIP_REJECTED'
测试：route.test.ts
覆盖无 skipReason、过长 skipReason、非 skip intent 携带 skipReason、SkipRejectedError 映射 422 等用例
UI：按钮 / 二次确认 / 已跳过徽标
代码：
skip-node-dialog.tsx / .test.ts：二次确认对话框，使用 skip-forward 图标；校验 skipReason 1–200 长度
streaming-log-card.tsx + stage-error-dialog.tsx：在 skippable && onSkip 时展示“跳过此环节”按钮，点击后打开 SkipNodeDialog
flow-elements.tsx / .test.ts：为 skipped 节点展示 label“已跳过”和 CircleSlash 图标
文档：docs/designs/Design-system-inventory.md 中登记了 skip-forward, circle-slash 等图标，UI 引用与文档一致
测试：对应组件的 test 覆盖按钮显示、跳过流程调用以及徽标渲染
skipped→pending 反悔重跑
状态机：status.ts 中 ALLOWED_TRANSITIONS 显式允许 skipped -> pending
行为：在 skipped -> pending 转移中清除 skipMeta 并将持久化状态回到 queued/pending
测试：status.test.ts 验证 skipped→pending 的转移合法，并清除 skipMeta
需求条目状态：
跳过节点类型范围与遍历断言：已覆盖
skipped 一等状态（schema+状态机+持久化）：已覆盖
skipMeta 留痕 & node-skip-marker 真字节真哈希：已覆盖
下游推进 & 降级导出占位：已覆盖
intent=skip & skipReason 合同 & 422 分支：已覆盖
UI 按钮/二次确认/徽标：已覆盖
skipped→pending 反悔重跑：已覆盖
4. 熔断：3 次连败 open 5min、half-open 试探、只记外部 provider 故障、显式备选、切换条件与不可用输出、降级留痕
结论：已覆盖覆盖点与证据：
3 次连败 open 5min & half-open 单次试探
代码：src/features/ai/provider-breaker.ts
FAILURE_THRESHOLD = 3
OPEN_WINDOW_MS = 5 * 60_000
isProviderAvailable(providerId) 实现 half-open：
open 窗口内直接 false
窗口过后第一次调用占用唯一 probe 名额（设置 probeUntil = now + PROBE_DEADLINE_MS），返回 true
在 probe 结论或 probe 超时前后续调用返回 false
recordProviderFailure / recordProviderSuccess 实现计数与状态转移
测试：provider-breaker.test.ts 中验证连续 3 次失败后 open 5min，窗口结束后 half-open 单次试探行为，以及 probe deadline 的兜底逻辑
只记外部 provider 故障
代码：src/features/director/pi-session.ts
在 run 结果收敛点调用 recordProviderSuccess / recordProviderFailure
RouteContractError 等内部矛盾在构建 runtime 时抛出，不会计入熔断计数
文档：docs/conventions/workflow-failure-patterns.md 模式 H 将熔断计数的唯一收敛点标明为 pi-session，强调“内部矛盾不得贴外部标签”
测试：pi-session 相关 test 用例（确认仅在 provider 调用失败时记录熔断）
备选显式配置，默认无
代码：src/features/ai/fallback-provider-store.ts
使用 workspace_settings 表以 key='ai.fallback-provider' 存储备选 provider
save(workspaceId, providerOrNull)：provider=null 时删除配置，表示显式清空备选；默认无备选
配置应用：src/features/ai/provider-settings-apply.ts
在验证通过后，若 fallbackProvider 字段存在，调用 fallbackProviders.save(currentWorkspaceId(), fallbackProvider) 写入或清空
文档：docs/configuration/model-routing.md 与 docs/conventions/routing.md 的 /api/settings 部分说明 fallbackProvider 字段语义
备选切换条件（能力 / Key / 非自身熔断）
代码：src/features/ai/model-routing.ts 中 degradeToFallback(...)
从 fallbackProviders.find(currentWorkspaceId()) 读出 fallback
使用 filterAuthorizedFallbacks({ plan, capability, candidates:[fallback] }) 检查当前 plan 与 capability 的授权
要求：
fallback 非空且 fallback !== primary
authorizedFallback 存在
providerSupports(authorizedFallback, capability)
isProviderAvailable(authorizedFallback)（自身熔断未打开）
通过 providerDefaults(authorizedFallback, deps) 获取默认模型与 apiKey：
若 defaults.apiKey 为空，同样抛 ProviderUnavailableError（备选缺 Key 视为不可用）
能力门禁：
validateProviderSettings 中预先校验 input.fallbackProvider 能力必须支持文本会话：
providerSupports(input.fallbackProvider, 'text') 不成立时直接 422 拒绝，并提示“不能作为备选 provider”
避免纯音频端点被设置为 fallback 的场景
全不可用 → PROVIDER_FAILED retryable=true
代码：resolveDirectorModelTarget(...)
调 isProviderAvailable(primary) 判断主选是否可用；不可用时进入 degradeToFallback
在 degradeToFallback 内若无合格 fallback 或 fallback 熔断或缺 Key，抛 ProviderUnavailableError
错误分类：src/features/canvas/workflow-error.ts
对 ProviderUnavailableError 按类型和文案匹配归类为：
code='PROVIDER_FAILED'
retryable=true
文案：“AI 服务暂时不可用，可稍后重试或选择跳过”
测试：workflow-error.test.ts 中验证按类型名与文案匹配均归入上述投影（retryable=true）
降级留痕（degradedFrom / routeLabel / 日志）
代码：model-routing.ts 中 DirectorModelTarget 结构与 degradeToFallback(...)
DirectorModelTarget.degradedFrom?: AiProviderId 仅在降级发生时设置为主选 provider
degradeToFallback 返回的结果：
provider = authorizedFallback
modelId = defaults.modelFor(target, capability)
degradedFrom = primary
通过 authorizeManagedRoute 计算 funding / deductsManagedPool
日志：console.warn('[ai] provider_fallback', { from: primary, to: fallback })
routeLabel：
文档：model-routing.md/workflow-failure-patterns.md 描述 routeLabel 的使用，标记具体路由位置
代码：Director runtime 与错误路径通过 routeLabel 记录具体调用路径
需求条目状态：
3 连败 open 5min & half-open 试探：已覆盖
只记外部 provider 故障：已覆盖
备选显式配置，默认无：已覆盖
备选切换能力/Key/非自身熔断条件：已覆盖
全不可用 → PROVIDER_FAILED retryable=true：已覆盖
降级留痕（degradedFrom / routeLabel / provider_fallback 日志）：已覆盖
5. 文档与测试：routing.md / workflow-failure-patterns.md / model-routing.md / Design-system-inventory / 功能对应测试
结论：已覆盖覆盖点与证据：
routing.md skip 条目 & fallbackProvider 说明
文件：docs/conventions/routing.md
/api/director/stage 跳过合同：intent=skip、skipReason 1–200 字必填、422 分支
/api/render/export 的 degraded 合同：degraded 导出、placeholderCandidates、final-mp4-degraded-manifest 等字段说明
/api/settings 字段涵盖 laneQuotas 与 fallbackProvider，明确 fallbackProvider 默认无备选、需能力兼容
对应实现：route.ts（skip API）、export-service.ts（导出降级）、provider-settings-* 与 model-routing.ts（fallbackProvider 相关）
workflow-failure-patterns.md 模式 H 四层护栏
文件：docs/conventions/workflow-failure-patterns.md
模式 H 描述四层护栏：租约（阶段1）、自动重试与预算闸门（阶段2）、手动跳过（阶段3）、Provider 熔断 + fallback（阶段4）
指向落地文件：
src/lib/queue/lease.ts + DB 迁移
retry-policy.ts / attempt-completion.ts
skip.ts / skip-policy.ts / /api/director/stage
provider-breaker.ts / model-routing.ts / fallback-provider-store.ts
现有实现与文档指向完全一致，且每一层都有单独测试锁定
docs/configuration/model-routing.md
文件：docs/configuration/model-routing.md
描述 AI 模型路由、provider 熔断窗口与 fallbackProvider 行为
说明 ProviderUnavailableError 的文案与 retryable=true 语义
对应实现：model-routing.ts / provider-unavailable-error.ts / workflow-error.ts，行为与文档描述一致
Design-system-inventory 图标登记
文件：docs/designs/Design-system-inventory.md
包含 skip-forward、circle-slash 等图标登记及使用场景
对应实现：
skip-node-dialog.tsx 使用 skip-forward 图标作为跳过按钮图标
flow-elements.tsx / StageErrorDialog 使用 CircleSlash / CircleX 等图标作为状态徽标
测试：相应组件的 test 中也验证这些图标的渲染（例如 lucide-circle-slash 的存在）
每项功能对应测试锁定
租约 / sweep / 心跳 / 超时：lease.test.ts / lease.pg.test.ts / in-process-queue.test.ts
自动重试 / 退避 / 预算闸门：retry-policy.test.ts / retry-policy.pg.test.ts / attempt-completion.pg.test.ts / director & render queue handler tests
跳过：skip-policy.test.ts / skip.pg.test.ts / status.test.ts / API route tests / UI 组件 tests / 导出链 tests
熔断与 fallback：provider-breaker.test.ts / model-routing.test.ts / provider-settings-validation.test.ts / workflow-error.test.ts
文档镜像：workflow-failure-patterns.md / model-routing.md / routing.md 与上述测试共同保证行为符合规范
需求条目状态：
routing.md skip 条目与 fallbackProvider 段落：已覆盖
workflow-failure-patterns.md 模式 H 四层护栏：已覆盖
docs/configuration/model-routing.md：已覆盖
Design-system-inventory 图标登记：已覆盖
每项功能均有对应测试：已覆盖
完整性缺口清单
按你给出的需求基线逐条核对，本次 5 个 commit（外加 routing.md 的 fallbackProvider 段落）在实现、文档与测试上均有对应落地，且关键路径被测试锁定。未发现新增需求未落地或半落地的情况。
阻断级缺口：无
建议级缺口：无
在完整性（需求覆盖）维度上，这一轮「工作流容灾降级」改动的阶段 1–4 与文档补齐已经实现了 workflow-failure-patterns.md 模式 H 描述的四层护栏，并保持与 routing.md / model-routing.md / Design-system-inventory 的真值一致，可视为需求全部到位。

————

[Perspective] correctness（逻辑 / 并发 / 安全）
Critical Issues (MUST FIX)
1. sweep 与 handler 完成对同一 attempt 存在抢写，可能覆盖「任务中断」投影（严重度：阻断）
src/lib/queue/lease.ts#L84-L149
src/lib/queue/in-process-queue.ts#L280-L311
src/lib/queue/attempt-completion.ts#L27-L93Problem当前设计下，同一 attempt 可以被以下两条路径先后写入终态，缺少「谁说了算」的并发约束：
僵尸回收路径（sweep）
   // sweepExpiredLeases：选出 lease 过期、status=running 的 attempt，事务内终态化
   .where(
     and(
       eq(taskAttempts.status, 'running'),
       isNotNull(taskAttempts.leaseExpiresAt),
       lt(taskAttempts.leaseExpiresAt, sql`now()`)
     )
   ).for('update', { of: taskAttempts, skipLocked: true })

   await transaction.update(taskAttempts).set({
     status: 'failed',
     failure: { schemaVersion: 1, message: LEASE_EXPIRED_FAILURE_MESSAGE },
     completedAt: new Date(),
     updatedAt: new Date(),
   })
   await transaction.update(pipelineRuns).set({ status: 'failed', ... })
正常执行完成路径（handler → completeAttempt）
   // run()：handler 成功 / 失败后无条件调用 completeAttempt
   await withExecutionTimeout(...handler...)
   await completeAttempt(database, job.workspaceId, job.id, 'succeeded')

   // or in catch:
   await completeAttempt(database, job.workspaceId, job.id, 'failed', err.message)
   // completeAttempt：按 attemptId 选行，仅按 workspaceId+id 过滤，不看当前 status
   const [attempt] = await transaction
     .select({ ... })
     .from(taskAttempts)
     .where(
       and(
         eq(taskAttempts.workspaceId, workspaceId),
         eq(taskAttempts.id, attemptId),
       )
     )
     .for('update')

   // retryable=false 时，直接把 status/failure/completedAt 覆盖写回
   await transaction.update(taskAttempts).set({
     status,
     failure: message ? { schemaVersion: 1, message } : null,
     completedAt: new Date(),
     updatedAt: new Date(),
   })
   await transaction.update(pipelineRuns).set({ status, completedAt: new Date(), ... })
并发场景推演
某 attempt A 被 worker 领取并进入 running，leaseExpiresAt 设为 T0 + 120s。
由于 heartbeat 长期失败或进程挂起，leaseExpiresAt < now() 成立。
此时：
sweepExpiredLeases 事务先抢到 taskAttempts(id=A) 的行锁：
将 A 标记为 status='failed'，failure=LEASE_EXPIRED_FAILURE_MESSAGE；
将对应 pipelineRuns 置 failed；
事务提交。
稍后，同一 attempt 在原进程里 handler 终于返回：
run() 仍然调用 completeAttempt(..., 'succeeded' | 'failed', message?)。
completeAttempt 用 FOR UPDATE 重新锁定同一行，但不校验 status 是否仍为 'running'。
再次 update taskAttempts/pipelineRuns，把 sweep 写入的「租约过期 / TASK_INTERRUPTED」终态覆盖掉：
status、completedAt、failure 文案、run 状态都以迟到 handler 的结果为准。
影响
状态机语义被破坏
对本应视为「执行进程已中断」的 attempt，最终 DB 里可能看起来像一次正常失败或成功；
而节点侧 projectInterruptedNodes 已经按「TASK_INTERRUPTED」写入了 directorError。
结果：
taskAttempts / pipelineRuns 显示「执行成功 / 普通失败」；
canvas_nodes.data.directorError 显示「TASK_INTERRUPTED」；
二者互相矛盾，Debug 难度显著增加。
错误分类不再单调
LEASE_EXPIRED_FAILURE_MESSAGE 本意是通过 workflow-error.ts 的 MESSAGE_RULES 归类为 TASK_INTERRUPTED（可重试），
但被覆盖后，分类会按新的文案走别的分支（如 PROVIDER_FAILED / CONFIGURATION_BLOCKED），直接改变业务判断。
重试 / 闸门统计混淆
租约过期这类故障应该更多被当作基础设施问题，而非业务毒任务；
被 sweep 回收后仍被迟到 completion 覆盖为「业务失败」，会多记一次业务层失败，干扰 countRecentFailures 的统计和重试预算判断。
Fix（建议修法）
核心是把「正在执行的 attempt 对自身终态拥有写权限」的边界收紧到 status='running'，其余状态视为「陈旧完成」，不再允许覆盖。方向示例：
// attempt-completion.ts
export async function completeAttempt(...) {
  const retriedNodeId = await database.transaction(async (transaction) => {
    const [attempt] = await transaction
      .select({
        runId: taskAttempts.runId,
        taskId: taskAttempts.taskId,
        entityType: taskAttempts.entityType,
        entityId: taskAttempts.entityId,
        attemptNo: taskAttempts.attemptNo,
        fingerprint: taskAttempts.fingerprint,
        checkpoint: taskAttempts.checkpoint,
        status: taskAttempts.status,          // ← 额外选出当前 status
      })
      .from(taskAttempts)
      .where(
        and(
          eq(taskAttempts.workspaceId, workspaceId),
          eq(taskAttempts.id, attemptId),
        ),
      )
      .for('update')
      .limit(1)

    if (!attempt) throw new Error(`legacy queue attempt not found: ${attemptId}`)

    // 非 running 说明已被 sweep 或其他路径终态化：视为陈旧完成，直接 no-op
    if (attempt.status !== 'running') {
      // 可选：记录一条 debug 日志，便于排查
      // console.warn('[queue] stale attempt completion ignored', { attemptId, status: attempt.status })
      return null
    }

    // ... 现有 retryable / scheduleRetry / 终态写入逻辑 ...
  })

  if (retriedNodeId) await resetNodeForRetry(workspaceId, retriedNodeId)
}
若希望更严格，可以直接在 SELECT 的 where 中加上 eq(taskAttempts.status, 'running')，并在未命中时把整个 completion 当作 no-op；
需要同步调整 scheduleRetry 中的 update(taskAttempts) 也带 status = 'running' 条件，避免在被 sweep 的 attempt 上错误打 superseded + 插入下一 attempt。
Warnings (SHOULD FIX)
（本次未发现其他明确 correctness bug，以下为需特别确认的方向；已逐条核实逻辑合理，仅建议保持关注或在文档中明确设计取舍。）
2. sweep 与 heartbeat / claim / 执行超时的并发窗口（严重度：中）
已核实无致命问题
heartbeat 与 sweep 的锁语义
src/lib/queue/in-process-queue.ts#L150-L166
src/lib/queue/lease.ts#L84-L149
heartbeat 只对 heldAttempts 里的 id 调 renewLeases，且 renewLeases 只更新 status='running' 行。
sweep 在 SELECT ... FOR UPDATE SKIP LOCKED 后立即在同一事务内更新相同行。
Postgres 行锁保证：如果 heartbeat 先锁住行，sweep 的 FOR UPDATE 会阻塞直到 heartbeat 提交，此时 lease_expires_at 已更新，不再满足 < now() 条件；反之亦然。
因此不会出现「刚续租却被 sweep 回收」的违背直觉情况；只有真正拿不到心跳的 attempt 会被回收。
claim 的 SKIP LOCKED + visible_at 判定
src/lib/queue/in-process-queue.ts#L200-L272
src/lib/db/migrations/pg/0005_orange_argent.sql#L1-L2
  .where(
    and(
      eq(taskAttempts.status, 'queued'),
      lte(taskAttempts.visibleAt, sql`now()`),
      kindCondition,
    )
  ).for('update', { skipLocked: true })
0005 migration 把 visible_at 新增为 DEFAULT now() NOT NULL，确保旧行也被 backfill 成非空，避免 NULL 阻断消费。
claim 后的 update ... where status='queued' + skipLocked 组合，能正确防止多进程重复领取。
执行超时 race 下的 double completion
src/lib/queue/lease.ts#L33-L58
src/lib/queue/in-process-queue.ts#L280-L311
  const running = task()
  running.catch(() => undefined) // 预吞掉迟到 rejection
  const result = await Promise.race([running, deadline])
run() 只根据 Promise.race 的结果调用一次 completeAttempt；
handler 自己没有再调用 completeAttempt 的职责；
running.catch 只是防止超时后迟到的 rejection 变成 unhandled rejection，不会触发额外 side-effect。
因此，即便超时后 handler 迟到 resolve/reject，也不会产生第二次 completeAttempt。
heldAttempts 清理
src/lib/queue/in-process-queue.ts#L180-L197
heldAttempts.add(job.id) 在领取后立即进行；
run(job).finally(...) 无论 handler 成功、失败还是 completeAttempt 抛错都会执行，负责：
this.running.set(laneKey, ...) 递减；
this.heldAttempts.delete(job.id) 清除租约续期列表。
没有看到「租约已过期但仍被 heartbeat 永久续租」之类的泄漏；出问题的核心还是上面那条 sweep vs completion 的写入时序。
Suggestions (CONSIDER)
以下为各题目方向的「已核实无问题 + 理由」，供补充信心或文档化。
3. 事务边界（superseded + 重试、sweep 与节点投影、skip 流水）
attempt-completion 的 superseded + 新 attempt 是否同事务
src/lib/queue/attempt-completion.ts#L97-L143
scheduleRetry 在 completeAttempt 的同一 transaction 回调中执行：
先 update taskAttempts 把当前 attempt 标记为 superseded；
再 insert taskAttempts 插入 attemptNo+1 的新 attempt，visibleAt 用 DB now() + backoff；
最后 update pipelineRuns 把 run 状态回到 'queued'。
三步在一个 DB 事务内完成，中途失败会整体回滚，不会出现「旧 attempt 已 superseded 但新 attempt 未插入」的中间态。
sweep 中 attempt/run 更新 与 事务外节点投影失败
src/lib/queue/lease.ts#L84-L149
src/lib/queue/lease.ts#L157-L194
attempt / run 的终态更新在一个 DB 事务里完成；
节点投影 projectInterruptedNodes 在事务外逐条运行，内部再各自开事务，并有 try/catch：
     } catch (error) {
       console.error('[queue] 僵尸回收的节点投影失败', { attemptId, nodeId, error })
     }
设计上接受「attempt/run 已标记 failed，但 canvas 节点仍停留在旧状态」这种只影响展示、可通过后续操作修复的软中间态。
不会破坏队列自身的幂等性或重试行为，因此从正确性角度可接受。
skip 的 artifact 登记 → 节点状态迁移 → advance 的中间态
src/features/director/skip.ts#L56-L110顺序：
createSkipAttempt：单独事务创建 pipelineRuns(status='running') + taskAttempts(status='running')。
registerSkipMarker：
先把 marker JSON 写入对象存储；
再读取实际字节计算 hash；
再调用 commitArtifactRecord 落 DB，失败时尝试删除存储对象（失败则抛 AggregateError）。
completeAttempt(..., 'succeeded')：结束 skip attempt。
transitionNodeStatus(..., 'skipped', skipMeta)：节点状态变成 skipped。
advancePipeline：推进下游。
其中 2–5 之间如果任何一步失败：
skip API 会抛错，客户端看到失败；
marker 已落盘但节点未转 skipped 的状态被视为「审计信息先写入，用户动作未完成」，
后续可以通过再次调用 skip 或普通执行来恢复流程；
流程里没有破坏不变量（不会生成一条没有归属 attempt 的 artifact，也不会把节点置成非法状态）。
因此这里的分阶段事务更像是「耐失败的审计链」，从 correctness 角度是可接受的设计权衡。
4. 状态机与计数 / 时钟
failed→pending 复位与重试预算闸门的交互
src/lib/queue/attempt-completion.ts#L145-L163
src/features/canvas/status.ts#L25-L34
src/lib/queue/retry-policy.ts#L49-L69
自动重试只复位 节点状态：resetNodeForRetry 把节点从 failed → pending。
预算闸门 assertEnqueueRetryBudget 统计的是 task_attempts 里 status='failed' 的行数，与节点状态无关。
因此，即便节点在 UI 上从 failed 复位成 pending，历史失败仍计入预算，闸门照常生效，不存在「复位后闸门失效」的问题。
skipped→pending 反悔与 skip marker 的残留语义
src/features/canvas/status.ts#L246-L277
src/features/director/skip.ts#L172-L221
状态机允许 skipped -> pending（重新执行）；
resolveTransitionData 在 current === 'skipped' 时，会把 payload.skipMeta 清掉，保证离开跳过态后不再自称已跳过；
node-skip-marker artifact 仍然存在，仅作为「曾经跳过过」的可审计记录，不再影响后续执行逻辑。
这种「审计 artefact 不回滚、业务状态可反悔」的设计是常见模式，从 correctness 上是合理的。
transitionNodeStatus 转 skipped 清错误字段
src/features/canvas/status.ts#L246-L283
转 success 或 skipped 时调用 withoutStageErrors 一次性清理 directorError / renderError；
status.test.ts 中有针对 skipped 清错误字段 + 写入 skipMeta 的单元测试覆盖。
这恰好修复了之前「succeeded 节点仍带上次失败描述」的投影矛盾，属于 correctness 加强。
countRecentFailures 窗口 & backoff 抖动
src/lib/queue/retry-policy.ts#L49-L69
统计窗口使用 completedAt >= now() - interval，窗口边界包含边界点，符合「30 分钟内失败 X 次」的直觉定义。
completedAt 目前用 new Date()（应用时钟），窗口边界使用 DB now()；
若应用与 DB 时钟存在大幅漂移，会导致计数略有偏差。不过：
相比 lease / visibleAt，对闸门而言尺度是 30 分钟，通常 NTP 能够保证误差远小于这个量级；
即便有偏差，表现为「略早或略晚触发闸门」，不会破坏数据一致性。
如果未来对「预算窗口必须严格按 DB 时钟」有更严要求，可以考虑也在 completeAttempt / sweep 中改为 completedAt = sql\`now()\`，但当前设计不构成 correctness bug。
backoff 抖动 base * (1 ± 0.2) 在 attemptNo >= 1 时恒为正，Math.round 不会把正数变成零，边界安全。
熔断 half-open 60s 试探与 globalThis 锚定
src/features/ai/provider-breaker.ts#L18-L27
src/features/ai/provider-breaker.ts#L62-L77
isProviderAvailable 在 open 窗口过后，第一次调用设置 probeUntil = now + 60s 并返回 true，后续 60 秒内调用都返回 false，保证 half-open 只有一次试探名额；
若试探请求进程中断未回报结论，60 秒后 probeUntil 超时，下一次调用会重新开放一个试探，避免永久卡死；
breaker map 锚定在 globalThis.__cvcProviderBreakers，与 queue/init.ts 同款模式，dev HMR 下不会因模块重新加载丢失计数。
在当前「单实例部署」前提下，这是一个线程安全且状态机自洽的实现。
5. 安全 / 红线方向
失败文案不泄露 provider 原始错误 / prompt / 凭据
src/features/director/pi-session.ts#L136-L151
src/features/canvas/workflow-error.ts#L46-L60
assertRunSucceeded 只把 agent.state.errorMessage 记录到服务端日志，并对熔断计数；
对外抛出的始终是自定义的 DirectorRunError(routeLabel)，其 message 形如：
Director 模型调用失败（gemini/gemini-1.5-flash），不含任何 provider 响应、prompt 或凭据；
classifyWorkflowError 对外部错误使用类型 + 文案规则映射成固定的中文说明，
不会把 provider 原始 message 直接暴露给画布 / API 返回体。
skipReason 不直接回显
src/app/api/director/stage/route.ts#L39-L71
src/features/director/skip.ts#L56-L110
API 请求体中的 skipReason 经过 zod 长度校验，仅用于：
skipNodeAction 内部记录 skipMeta.reason；
写入 node-skip-marker artifact。
HTTP 200 响应中只返回标准文案（「已跳过此环节，成片将以占位/缺省产出继续 …」），不含用户输入的 reason。
422 情况只返回 SkipRejectedError 设定的短文案，同样不包含原始 reason 内容。
因此 skip 原因主要用于审计，不会被浏览器或其他客户端原样反射回显。
fallback-provider-store 不会被注入非法 provider id
src/features/ai/fallback-provider-store.ts#L24-L33
src/features/ai/schemas.ts#L130-L138
DB 读时，通过 payloadSchema = z.object({ schemaVersion: literal(1), provider: z.enum(AI_PROVIDER_IDS) }) 校验，未知 id 直接返回 null；
设置面写入的 fallbackProvider 由 textProviderSchema（同样基于 AI_PROVIDER_IDS）约束，并在
validateProviderSettings 中用 providerSupports(..., 'text') 做能力门禁；
model-routing.degradeToFallback 再次检查 providerSupports(fallback, capability) 和 isProviderAvailable(fallback)。
整体链路对 provider id 做了「schema -> 能力 -> breaker」三层校验，不会因为恶意 payload 注入不可识别 provider 而导致 runtime 崩溃。
API 422 / 409 输入校验
src/app/api/director/stage/route.ts#L14-L34
400：请求体 JSON 解析失败或未通过 zod schema（projectId/nodeId/intent 基本结构错误）；
422：业务规则拒绝 skip（SkipRejectedError），如「节点状态不允许跳过」「原因长度不合法」；
409：其余执行期业务错误统一走 classifyWorkflowError，返回已归类的 code 和稳定文案。
这条分界线清晰，且不会把内部错误栈或 provider 报文透给客户端。
6. 错误分类规则（TASK_INTERRUPTED / RETRY_BUDGET_EXHAUSTED）
src/features/canvas/workflow-error.ts#L120-L212
TASK_INTERRUPTED 规则：
  /执行进程中断|租约过期/ → { code: 'TASK_INTERRUPTED', retryable: true }
匹配的刚好是 LEASE_EXPIRED_FAILURE_MESSAGE = '执行进程中断，租约过期自动回收'；
文案中并不包含诸如「超时 / Key / quota」等词，不会误命中其他规则；
规则位置在「媒体未就绪」之后、「预算耗尽 / 配置阻断 / provider 失败」之前，确保不会被笼统模式 B/D 盖过去。
RETRY_BUDGET_EXHAUSTED 规则：
  /已暂停重试/ → RETRY_BUDGET_EXHAUSTED_PROJECTION
闸门报文中「已暂停重试」是特有短语，不会出现在其他错误消息中；
规则被特意放在「配置 / 额度」笼统规则之前，避免被误归为 CONFIGURATION_BLOCKED（模式 D）。
熔断 ProviderUnavailableError 规则：
  /AI 服务暂时不可用/ → PROVIDER_UNAVAILABLE_PROJECTION
同样放在笼统的 CONFIGURATION_BLOCKED / PROVIDER_FAILED 之前；
文案内不含 Key / quota 等关键字，避免模式 D 误判。
综合上述，当前 MESSAGE_RULES 顺序与新增报文设计是一致的，没有看到会把其他报文错误地归到 TASK_INTERRUPTED / RETRY_BUDGET_EXHAUSTED 的具体路径。


——————

[Perspective] impact（影响面：既有功能回归 / 破坏性变更）
Critical Issues (MUST FIX)
本次评审未找到可以确定为回归且会立即破坏既有功能的问题（阻断级）。下面列出的均为行为改变或潜在风险，归入 Warning / Suggestions。
Warnings (SHOULD FIX)
导出队列执行超时与 30 分钟轮询上限语义不一致（严重度：中）
src/lib/queue/in-process-queue.ts#L295-L302
src/lib/queue/lease.ts#L14-L26
src/features/render/export-queue-handler.ts#L104-L131Problem
队列侧对所有未显式登记的 kind 使用默认执行超时 10 分钟：
  // lease.ts
  export const EXECUTION_TIMEOUT_MS: Readonly<Record<string, number>> = {
    'director-stage': 10 * MINUTE_MS,
    'render-shot': 15 * MINUTE_MS,
  }
  export const DEFAULT_EXECUTION_TIMEOUT_MS = 10 * MINUTE_MS
队列执行逻辑对所有 job 都包上 withExecutionTimeout(job.kind, ...)：
  // in-process-queue.ts
  await withExecutionTimeout(job.kind, () =>
    runInAuthContext(
      { workspaceId: job.workspaceId, userId: SYSTEM_USER_ID },
      () => handler(job),
    ),
  )
项目级导出 export-project 没有专门的超时配置，落入默认 10 分钟。而 AUTOPILOT 的 FINALIZE 阶段通过 runProjectExport 轮询 job，显式允许 30 分钟：
  // export-queue-handler.ts
  const POLL_INTERVAL_MS = 1_000
  /** 30 分钟上限：足够长片拼接，又不会无界挂住调用方。 */
  const DEFAULT_MAX_POLLS = 1_800
可确定的行为变化：
旧行为：FINALIZE 阶段的导出路径只有 30 分钟轮询超时，没有 10 分钟的队列级强制超时；只要导出在 30 分钟内完成，autopilot 视为成功。
新行为：导出作业在队列里如果运行超过 10 分钟，会触发 ExecutionTimeoutError，由队列侧记为 attempt.status='failed'，job.status='failed'，runProjectExport 看到 failed 立即抛错，即使距离 30 分钟轮询上限仍有余量。
这是一个明确的语义收紧：导出作业的可运行时间从「由 concat 实际耗时 + 30 分钟轮询兜底」变为「硬上限 10 分钟」。在没有运行时统计的前提下无法判断具体项目是否已经被这个上限“误杀”，但从契约角度看：
runProjectExport 的注释仍宣称 30 分钟是“足够长片拼接”的上限；
队列超时实际把导出能力收紧到 10 分钟，与既有注释和调用方预期不符。
Fix（方向建议）
为导出和其他长任务显式配置更接近轮询上限的执行超时，而不是落入默认值。例如：
  // lease.ts
  export const EXECUTION_TIMEOUT_MS: Readonly<Record<string, number>> = {
    'director-stage': 10 * MINUTE_MS,
    'render-shot': 15 * MINUTE_MS,
    'export-project': 30 * MINUTE_MS,   // 显式对齐 runProjectExport 的轮询上限
    'media-narration': 30 * MINUTE_MS,  // 如需支持大项目长配音，可一并声明
  }
或者，在 withExecutionTimeout 中对特别长的 kind 允许无限制（不走默认值），改由 runProjectExport 的 30 分钟轮询兜底控制整体等待时间。
同步更新注释，明确说明导出作业的队列执行上限与轮询上限的关系，避免误导调用方。
自动重试机制对外部 Provider 调用次数的扩增（严重度：中）
src/lib/queue/attempt-completion.ts#L57-L63
src/lib/queue/retry-policy.ts#L35-L47
src/features/canvas/workflow-error.ts#L92-L101
src/features/director/queue-handler.ts#L67-L80
src/features/render/queue-handler.ts#L111-L132Problem新引入的自动重试链条会让部分已有 handler 在一次失败后自动执行多次：
完成逻辑增加自动重试判断：
  const retryable =
    status === 'failed' &&
    message !== undefined &&
    (options?.allowAutoRetry ?? true) &&
    shouldAutoRetry(message, attempt.attemptNo, retryStage(attempt.checkpoint))
  if (retryable) {
    await scheduleRetry(...)
    return attempt.entityType === 'node' ? attempt.entityId : null
  }
shouldAutoRetry 基于 classifyWorkflowError 的 retryable，并限制 attemptNo <= MAX_AUTO_RETRIES (2)：
  export function shouldAutoRetry(failureMessage: string, attemptNo: number, stage = 'QUEUE'): boolean {
    if (attemptNo > MAX_AUTO_RETRIES) return false
    return classifyWorkflowError(new Error(failureMessage), { stage }).retryable
  }
对 director-stage / render-shot 的入队路径增加了毒任务闸门：
  // director / render enqueue
  await resolved.assertRetryBudget?.('director-stage', payload)
  await resolved.assertRetryBudget?.('render-shot', payload)
这意味着：
对所有被 classifyWorkflowError(...).retryable === true 归类的失败，既有的 director-stage、render-shot handler 现在会在一次失败后自动再跑最多 2 次，而不是停在单次失败。
自动重试发生在后台队列中，不需要用户显式点击“重试”，但会额外消费外部模型调用（AI、TTS、ASR）配额。
从功能角度讲，这是“增加容灾重试能力”，但从影响面来看：
之前“用户只点一次执行就只调用一次外部服务”的隐含假设不再成立；
对已经上线的 workspace，失败场景下的外部计费（tokens / TTS 分钟等）会增加，属于明确的新副作用。
这一改变本身不是逻辑错误，但属于对既有行为的重要扩展，在计费敏感环境中需要清晰告知。Fix（方向建议）
在产品和文档层面补充说明：
“对于被判定为可重试的错误（如 PROVIDER_FAILED、MEDIA_FAILED），系统会在后台自动重试最多 2 次，并在 30 分钟窗口内按毒任务预算限制次数。”
如果希望对某些 handler 保持“严格一次调用”的旧行为（例如特定扣费敏感阶段）：
明确在这些 handler 里调用 completeAttempt(..., { allowAutoRetry: false })，禁用自动重试；
或在特定错误类型上通过 WorkflowErrorProjection.retryable = false 把错误标为不可重试。
Suggestions (CONSIDER)
导出 readiness 与 skipped 终态的语义分层（严重度：低）
src/features/director/advance-repository.ts#L70-L83,L120-L152,L164-L177
src/features/render/repository.ts#L150-L165,L172-L205Problem新增 skipped 状态同时影响两套消费方：
自动推进与项目完成度：
  // advance-repository.ts
  async listCompletedNodeIds(...) { status in ('succeeded','skipped') }
  async areAllUpstreamsSuccessful(...) {
    upstreams.every(status === 'succeeded' || status === 'skipped')
  }
  async isProjectComplete(...) {
    notInArray(status, ['succeeded','skipped']) // 视 skipped 为终态
  }
导出 readiness 使用 legacyNodeStatus，把 succeeded 映射为 success，其余状态原样：
  // repository.ts
  const incomplete = new Set(
    nodes.filter((node) => legacyNodeStatus(node.status) !== 'success').map((node) => node.id),
  )
因此：
对 autopilot / pipeline 来说，skipped 被视为“完成”，不会阻塞项目前沿和下游解锁；
对导出 readiness 来说，skipped 节点仍被视为“未完成”，正常导出会在 incompleteNodeIds 中看到这些节点，只能通过降级导出占位出片。
这一分层设计本身是合理的（跳过节点不再阻塞流水线，但导出仍需要通过降级占位来补全），只是语义较复杂：
在 UI 与接口层需要确保已经清晰表达“跳过＝流水线终态，但导出仍可能是降级版本”。
Fix（方向建议）
在导出 readiness API 和 UI 文案中明确解释：
skipped 节点会让正常导出视为不完整，需降级模式占位；
项目完成度判断里 skipped 视为终态，不再阻塞其它节点的执行。
可考虑在前端对 incompleteNodeIds 中的 skipped 节点标注不同的状态（例如“已跳过，导出为降级版本”），避免用户误解为“真正失败”。
租约过期与 TASK_INTERRUPTED 错误分类的行为变化说明（严重度：低）
src/lib/queue/lease.ts#L84-L149
src/features/canvas/workflow-error.ts#L120-L142
src/features/canvas/queries.ts#L124-L162Problem新增的僵尸回收和错误分类逻辑，会让之前“卡在 running 的旧 attempt”被统一投影为可重试的 TASK_INTERRUPTED：
sweepExpiredLeases 将租约过期的 running attempt 标记为 failed，并写入统一报文：
  export const LEASE_EXPIRED_FAILURE_MESSAGE = '执行进程中断，租约过期自动回收'
projectInterruptedNodes 通过 transitionNodeStatus(...,'failed') 和 recordStageError 把中断投影到节点：
  await transitionNodeStatus(row.entityId, 'failed')
  await repository.recordStageError(..., new Error(LEASE_EXPIRED_FAILURE_MESSAGE))
分类器中新增 TASK_INTERRUPTED 规则：
  /执行进程中断|租约过期/ => {
    code: 'TASK_INTERRUPTED',
    message: '执行进程中断，任务已自动回收，可重试',
    retryable: true,
  }
这意味着：
旧行为：服务崩溃 / 队列进程宕机时，节点可能长时间停留在 running，UI 看不到明确错误类别；
新行为：这些“僵尸 attempt”会被统一视为 TASK_INTERRUPTED，节点状态变为 failed，错误投影可见且标为可重试。
这是对既有行为的改进，但也是明显的行为变化，用户可能第一次看到这种新类别。Fix（方向建议）
在失败弹窗 / 错误说明中补充短文案，解释：
“执行进程中断（租约过期自动回收）是系统为了回收僵尸任务的保护机制，您可以放心重试该环节。”
已核实的安全方向（按用户关注点逐条说明）
下面是针对用户给出的 7 个排查方向，明确说明当前改动不会破坏既有功能的地方及理由。
1. 队列行为变化对既有 handler 的影响
visibleAt + claim 行为（安全）
src/lib/db/migrations/pg/0005_orange_argent.sql#L1-L2
src/lib/db/schema/execution.ts#L87-L107
src/lib/queue/in-process-queue.ts#L200-L233
新增列 visible_at timestamp with time zone DEFAULT now() NOT NULL 在 Postgres 中会为存量行填充 now()，不会留下 NULL。
claim 条件增加 lte(taskAttempts.visibleAt, now())，对迁移前的旧 attempt 来说，visible_at 在迁移时即为接近当前时间，满足条件；不会出现“旧任务永远领不到”的情况。
自动重试插入的新 attempt 显式设置 visibleAt = now() + backoffMs(...)，仅对重试延迟生效，对老任务的领取消费完全兼容。
director-stage / render-shot / media-narration handler 与租约（安全）
src/lib/queue/lease.ts#L60-L72
src/lib/queue/in-process-queue.ts#L150-L157
src/features/director/queue-handler.ts#L49-L56
src/features/render/queue-handler.ts#L69-L108
src/features/audio/narration-queue-handler.ts#L58-L99
心跳只续租本进程持有的 attempt（heldAttempts），不会影响其它 workspace 的作业归属。
僵尸回收只回收 status='running' AND lease_expires_at < now() 的 attempt，并将 run 一并置 failed，避免旧 run 永远 stuck。
对正常 running 的 director-stage / render-shot / media-narration 来说，只要进程活着且心跳正常，就不会被 sweep 误伤。
自动重试与非幂等 handler（风险已在上文“自动重试次数扩增”中说明，属于行为扩展而非逻辑错误）
2. failed→pending 自动复位与 UI 失败投影
src/lib/queue/attempt-completion.ts#L57-L63,L145-L163
src/features/canvas/status.ts#L25-L34,L262-L278
src/features/canvas/queries.ts#L124-L162
src/features/director/recovery.ts#L240-L244
自动重试前的节点复位路径：
  if (retriedNodeId) await resetNodeForRetry(workspaceId, retriedNodeId)
  // resetNodeForRetry 内部调用 transitionNodeStatus(nodeId, 'pending')
failed -> pending 的状态机转换在 resolveTransitionData 中不会清理 directorError / renderError，错误字段依然保留在节点 data 中：
  if (next === 'success') return withoutStageErrors(data)
  if (next === 'skipped') { ... } // 仅 skipped 清理错误并写入 skipMeta
  if (current === 'skipped') { ... } // 仅离开 skipped 时删 skipMeta
CanvasGraph 投影中，parseDirectorError / parseRenderError 只看 data.directorError / data.renderError，与节点状态无关：
  directorError: parseDirectorError(data),
  renderError: parseRenderError(data),
结论：
自动重置到 pending 并不会清掉错误投影，用户在 Inspector / 流日志中仍能看到失败原因，不会出现“失败一闪而过就看不到错误”的回归。
repairProjectFrontier 仍然只在 node.status === 'failed' && error.retryable === false 时视为硬阻塞，自动重试结束后的最终失败节点仍按原逻辑阻塞；自动重试期间节点处于 pending，不影响已有 “不可重试错误阻塞前沿” 的语义。
3. NodeStatus 加 skipped 后各消费方的覆盖情况
src/lib/db/migrations/pg/0006_flashy_talkback.sql#L1-L4
src/lib/db/schema/canvas.ts#L37-L46,L98-L102
src/features/canvas/types.ts#L20-L28
src/features/canvas/status.ts#L25-L34,L320-L333
src/lib/stream/status-bus.ts#L12-L20
src/features/director/advance-repository.ts#L70-L83,L120-L152,L164-L177
src/features/render/repository.ts#L150-L165,L172-L205已检查的消费方均已显式支持 'skipped'：
DB 层：canvas_nodes_status_check 允许 'skipped'，schema NODE_STATUSES 包含 'skipped'。
领域类型：NodeStatus union 加入 'skipped'；状态机 ALLOWED_TRANSITIONS 声明了 failed/cancelled/stale -> skipped 与 skipped -> pending。
状态流：statusBus 的 NodeStatusValue 包含 'skipped'，SSE live status 能正确回放。
前沿与 autopilot：listCompletedNodeIds、areAllUpstreamsSuccessful、isProjectComplete 全部把 'skipped' 视为“完成”，用于推进和完成度判断。
导出 readiness：通过 legacyNodeStatus 将 'succeeded' 映射为 'success'，其它保持原值，skipped 仍被视为“未完成”，由降级导出占位链处理。
结论： 没有发现遗漏 'skipped' 导致旧消费方炸掉的地方；语义分层（流水线完成 vs 导出完整性）已在上文单独说明。
4. 错误分类器的新码与 MESSAGE_RULES 顺序
src/features/canvas/workflow-error.ts#L62-L102,L105-L118,L120-L212
新增类型：
TASK_INTERRUPTED：租约过期回收路径；
RETRY_BUDGET_EXHAUSTED：重试预算闸门；
通过类型名 RetryBudgetExhaustedError / ProviderUnavailableError 优先判定。
新增文案规则：
/执行进程中断|租约过期/ → TASK_INTERRUPTED，排在 provider / 产物等笼统规则前；
/已暂停重试/ → RETRY_BUDGET_EXHAUSTED，排在 CONFIGURATION_BLOCKED 前；
/AI 服务暂时不可用/ → PROVIDER_FAILED（可重试），排在 CONFIGURATION_BLOCKED 前。
这些正则均匹配新引入的固定报文，而非早就存在的旧错误文本；且位置都刻意放在更笼统规则之前，避免“被抢走”或“误归笼统类”。结论：
不会把旧报文从原类别抢走；新文案对应的新类型，UI 消费方只需按现有 WorkflowErrorProjection.code/retryable 行为展示即可（弹窗、重试按钮逻辑不需要特例）。
5. 模型路由与熔断降级链的等价性
src/features/ai/model-routing.ts#L159-L233,L235-L260
src/features/director/pi-provider.ts#L90-L152
src/features/director/pi-session.ts#L80-L111,L127-L151
src/features/ai/provider-settings-apply.ts#L37-L108
src/features/ai/provider-settings-validation.ts#L39-L50
熔断检查仅在解析真实调用模型的地方执行：
  const primary = configured?.provider ?? defaultProviderFor(target, plan)
  if (!isProviderAvailable(primary)) {
    return degradeToFallback(primary, target, capability, plan, deps)
  }
当 breaker 处于 closed / 未初始化状态时（默认），isProviderAvailable(primary) 返回 true，降级链完全旁路：
不读取 fallback 配置；
不设置 degradedFrom；
与旧版逻辑一样：先用 DB 路由，再用 defaultProvider + default model。
降级链条件非常保守：
  const fallback = await deps.fallbackProviders?.find(currentWorkspaceId()) ?? null
  const [authorizedFallback] = fallback
    ? filterAuthorizedFallbacks({ plan, capability, candidates: [fallback] })
    : []
  if (
    !fallback ||
    fallback === primary ||
    !authorizedFallback ||
    !providerSupports(authorizedFallback, capability) ||
    !isProviderAvailable(authorizedFallback)
  ) {
    throw new ProviderUnavailableError()
  }
  const defaults = await providerDefaults(authorizedFallback, deps)
  if (!defaults.apiKey) throw new ProviderUnavailableError()
未配置 fallback 时，行为是抛 ProviderUnavailableError（UI 上表现为可重试的 PROVIDER_FAILED），不会偷偷替用户换 provider。
fallback 必须支持文本能力且通过 validateProviderSettings 预先校验，否则保存阶段就拒绝设置。
设置 schema 的扩展：
  // schemas.ts
  fallbackProvider: textProviderSchema.nullable().optional(),
字段是可选 + nullable；旧客户端不提交此字段仍然通过 schema。
校验和保存阶段只在字段非 undefined 时校验/写入，不会影响旧请求。
routeLabel 的变化只在降级时附加“备选，主选已熔断”的说明，对旧路径没有影响：
  routeLabel: target.degradedFrom
    ? `${target.provider}/${target.modelId}（备选，主选 ${target.degradedFrom} 已熔断）`
    : `${target.provider}/${target.modelId}`,
结论：
在 breaker 未触发的健康路径下，模型路由行为与旧版严格等价。
新增的 fallback 配置是向后兼容的扩展，不会破坏现有设置 API 调用。
pi-session 中的熔断记账仅在实际模型调用失败时计数，不会把路由层配置错误混入 provider 故障统计。
6. 迁移 0005/0006 的存量数据影响与回收语义
src/lib/db/migrations/pg/0005_orange_argent.sql#L1-L2
src/lib/db/schema/execution.ts#L87-L107
src/lib/queue/lease.ts#L84-L149
src/lib/db/migrations/pg/0006_flashy_talkback.sql#L1-L4
src/lib/db/schema/canvas.ts#L37-L46,L99-L103
task_attempts.visible_at 的新增使用 DEFAULT now() NOT NULL，对存量行会统一填充当前时间；不会出现“旧 queued attempt 的 visible_at 永远为 NULL”从而既不能 claim 也不能 sweep 的情况。
僵尸回收条件显式要求 lease_expires_at IS NOT NULL：
  where status = 'running'
    AND isNotNull(lease_expires_at)
    AND lease_expires_at < now()
对于迁移之后新产生的 running attempt，claim 时会设置 lease_expires_at = now() + interval。
对极端情况下仍为 NULL 的旧数据（理论上不应存在），不会被 sweep 误伤；结合默认值，实际不会出现“永不回收的僵尸”。
0006 的 CHECK 约束仅在 canvas_nodes.status 上增加 'skipped'，不会改变旧状态的合法性；迁移语句只是 drop + add constraint，对表数据不做重写。
schema-metadata 对这些列和约束均有覆盖测试（见 schema-metadata.pg.test.ts），确保迁移后的枚举集合与代码声明一致。
结论：
在 Postgres 语义下，存量数据不会因为新列和新 CHECK 被误判或卡死；僵尸回收只针对有租约且过期的 running attempt，配合默认值可以安全清理旧进程遗留。
7. Git 历史卫生
目标 5 个 commit 的 git show --stat 输出显示：
5f60d48、d2cecfe、aa8a606 仅修改队列、DB schema 和 canvas workflow-error 相关文件；
f66d192 修改 canvas / director / render 等与 skip & 降级导出有关的 TS 文件和相关 docs；
be3df80 修改 AI 配置、路由、熔断器和 workflow-error；未触及 auth 代码或 .qoder/**。
另查 8f3fc58 fix(auth)：
  8f3fc58 fix(auth): 移除 proxy 对认证页的形状拦截，修复残留失效 cookie 的无限重定向循环
   docs/conventions/routing.md |  6 +++---
   src/proxy.test.ts           | 15 ++++++---------
   src/proxy.ts                | 14 ++++++--------
与本次评审的 5 个 commit 在 routing.md 上的改动处不重叠（我们新增的是 /api/director/stage 的 skip 合同段落），不会覆盖或删除 8f3fc58 的 auth 修复说明；也没有把 proxy 改动重新引入或回滚。结论：
这 5 个 commit 没有夹带 .qoder/**、他人 auth 逻辑或其它超出工作流容灾降级范围的代码文件；routing.md 的当前状态同时包含 8f3fc58 的 auth 修复说明和 f66d192 的 skip/降级导出合同补充，git 历史在功能范围内是干净的。
以上是从影响面（impact）维度，对指定 5 个 commit 所做的回归与行为变化评审结果。总体来看：
没有发现会立即破坏既有工作流或 UI 功能的阻断级问题；
存在一处需要关注的执行超时语义收紧（导出队列 10 分钟 vs 30 分钟轮询），以及自动重试引入的外部调用次数扩增，这两点建议在设计层面进一步确认和调整；
其它重点关注点（failed→pending 自动复位、skipped 状态机与所有消费方、错误分类器新码、模型路由熔断与备选降级链、迁移安全、git 历史卫生）均已核实不会让旧行为“变坏”。
