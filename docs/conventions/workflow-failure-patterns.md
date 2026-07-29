# 工作流失败模式手册

本文件是 Director / 渲染 / 音频 / 模型路由这条链路上**已经真实发生过**的失败模式清单。
每条模式都来自一次线上事故，包含症状、真实病因、必须做的检查与已落地的护栏。

适用范围：改动 `src/features/director`、`src/features/audio`、`src/features/render`、
`src/features/ai`、`src/features/canvas/workflow-error.ts` 或任何阶段合同前，先读本文。
新发现的复发型失败请**追加为新模式**，不要另开文件，也不要把结论散落进 issue 记录。

本文件不替代 `docs/conventions/routing.md`（路由真值）与 `docs/designs/*`（视觉真值），
只负责「同一类错误不要再犯第二次」。

---

## 1. 诊断顺序：先拿服务端真值，再谈现象

UI 弹窗里的文案是**脱敏投影**，不是原始报文。按这个顺序取证，实测每一步都必要：

| 步骤 | 位置 | 能回答什么 |
| --- | --- | --- |
| 1 | `canvas_nodes.status` + `data.payload.directorError` | 哪个节点失败、给用户看到了什么类别 |
| 2 | `task_attempts.failure` | 持久化的脱敏结构化故障（code、safe message、referenceId、recovery）；供应商原始正文、Prompt 与凭据不得入库 |
| 3 | attempt 的 `started_at` → `completed_at` | 几十毫秒 = 根本没调模型，问题在应用内 |
| 4 | `artifacts` 表与 `.data/artifacts/<domain>/<projectId>/<nodeId>/` | 哪一阶段真的写出了产物，链路断在哪一环 |
| 5 | `model_routes` / `media_routes` | 文本与媒体路由的真值（provider + model） |
| 6 | dev server 窗口 / `.next/dev/logs` | 是否根本没加载到新代码（见模式 F） |

本地取证模板（Windows PowerShell，容器名以 `docker ps` 为准）：

```powershell
docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -A -F " | " -c `
  "select project_id, logical_key, stage, status, updated_at from canvas_nodes where status='failed' order by updated_at desc limit 10"

docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -c `
  "select left(failure->>'message',600) as err, checkpoint->'payload'->>'stage' as stage, created_at from task_attempts where status='failed' order by created_at desc limit 5"

docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -A -F " | " -c `
  "select ai_task_kind, provider, model from model_routes"
docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -A -F " | " -c `
  "select media_task_kind, provider, model from media_routes"
```

判定「是否真的调过模型」优先看 attempt 时长与阶段产物，不要只看 `ai_invocations`
（legacy director 路径不写这张表，空表不等于没调用）。

---

## 2. 模式 A：同一契约的平行窄定义

**症状**：某个阶段 100% 失败，报文是 `unrecognized_keys` / `invalid_type`，而上游阶段产物看起来完全正常。

**真实事故**：`prompts/shot-spec.ts` 把 `target.sourceUnit` 重写成只允许
`{ unitId, text }` 的 `.strict()` 对象，而 INGEST 提示词明确要求模型输出 `order`，
SSOT 的 `scriptUnitSchema` 还允许 `speaker`。于是 SHOT_SPEC 在 `buildPrompt` 阶段
抛错，一次模型都没调（attempt 55ms 内失败），撰写分镜脚本永久失败。

**规则**：

- 跨阶段流动的数据结构只能有一个 zod 定义。script unit 的真值是
  `src/features/director/schemas/ingest.ts`；shot plan 的运行时真值是
  `schemas/director-shot-plan.ts`（`passthrough`），严格门禁真值是 `schemas/shot-plan.ts`。
- 任何 prompt 输入 schema 里**不得内联重写**已有契约的子结构，必须 import 复用。
- `.strict()` 只允许出现在「这一层的键集合由我定义」的地方；上游原样流入的对象一律复用上游 schema。

**已落地护栏**：`src/features/director/prompts/prompts.test.ts` 的
「INGEST script unit 合同跨阶段流通」——一个填满所有可选字段的 script unit 必须能流入
INGEST / DIRECT / SHOT_SPEC / ASSEMBLE·shot-sfx / ASSEMBLE·shot-subtitle 的输入合同。
新增消费方时必须把它加进那张表。

---

## 3. 模式 B：内部错误被贴上外部标签

**症状**：弹窗说「镜头渲染或媒体处理失败」或「外部生成服务本次执行失败」，并给出重试按钮；
用户重试 N 次，每次都在同一秒失败。

**真实事故（两起）**：

1. SHOT_SPEC 的 zod 合同错误未命中任何文案规则，落进最后的 `RENDER_FAILED` 兜底——
   阶段指错、原因指错，还劝用户重试。
2. `shot-sfx 是媒体节点，不能解析为 Director 模型` 这条**内部路由矛盾**因为含「模型」二字，
   命中 `/provider|模型|网络|timeout|超时|ASR|TTS/` 规则，被归成 `PROVIDER_FAILED`
   且 `retryable=true`。

**规则**：

- `classifyWorkflowError` 的判定顺序是 `classifyByType` → `classifyByMessage` → `classifyByStage`。
  **类型永远优先于文案**：zod 报文天然含 `required` / `invalid`，靠关键词匹配必然误判。
- 新增错误来源时先问：这是外部原因还是应用内部矛盾？内部矛盾必须 `retryable=false`，
  否则 `StageErrorDialog` 会展示重试按钮，`recovery` 也会反复重排同一个必败作业。
- 兜底类别必须按阶段职责给：`RENDER_FAILED` 只属于 `RENDER`，`MEDIA_FAILED` 只属于
  `MEDIA_NARRATION`，文本阶段用 `STAGE_FAILED` 且文案带阶段名。禁止再出现「所有未识别错误都自称渲染失败」。
- 文案可以点名**我们自己合同的字段路径**（如 `target.sourceUnit.order`），
  不得回显字段取值、原稿、prompt、凭据或 provider 原始响应。

**已落地护栏**：`src/features/canvas/workflow-error.test.ts` 覆盖
「非渲染阶段不得称渲染失败」「schema 失败必须点名字段且不可重试」「各阶段兜底归位」。
内部路由/能力矛盾另有 `RouteContractError`（`src/features/ai/route-contract-error.ts`），
`classifyByType` 按类型识别为 `ROUTE_CONTRACT_INVALID` 且 `retryable=false`，
断言见同一测试文件「路由/能力矛盾归类为不可重试的配置问题」。设置 API 会在任何
无关设置写入前解析路由合同，`RouteContractError` 映射为带具体配置文案的 422；
`repairProjectFrontier` 会把所有持久化 `retryable=false` 的失败列为 `blocked`，
`advancePipeline` 不会自动重排这类失败。

---

## 4. 模式 C：节点类型 × 阶段矩阵没有全覆盖

**症状**：某一类泳道节点全线失败，其他阶段完全正常；全套测试却是绿的。

**真实事故**：`feat(ai): 建立能力感知的供应商注册表` 在 `resolveDirectorModelTarget`
开头加了「媒体域节点直接抛错」。但 `shot-sfx` / `shot-subtitle` 这两个节点**同时**需要
一个文本模型（LLM 产出音效清单 / 字幕规划，历史上有 77 个节点成功并留下 `director-assemble` 产物）
和一条媒体路由（TTS / ASR）。改动把「媒体域 → 回落默认文本模型」变成了硬抛，
两个职责被当成一个，音效与字幕通道全线失败。测试全绿是因为没有任何一条断言覆盖
`resolveDirectorModelTarget('shot-sfx')`。

**规则**：

- 一个节点类型可以同时有**文本职责**与**媒体职责**。路由建模必须能分别表达，
  不能用一个 `domain` 字段把节点二分。
- 凡是以 `Record<CanvasNodeType, …>` 或 `Record<PipelineStage, …>` 表达的映射，
  TypeScript 只保证键齐全，**不保证语义正确**。这类映射改动必须配一条遍历
  `DIRECTOR_NODE_TYPES` / `PIPELINE_STAGES` 全集的断言。
- 给任意 dispatcher 加「不支持 / 不能 / 未知」的硬抛之前，先确认现有节点类型里
  没有正在走这条路的。历史成功记录（artifacts 表按 `node.type` 分组）是最快的证据。

**已落地护栏**：`src/features/ai/route-target.ts` 把 `ROUTE_TARGET`（节点的主职责
路由）与会话路由分开——`model-routing.ts` 的 `sessionTarget()` 把媒体域节点的
Director 会话改写为 `project-plan` 文本任务，不再对媒体域抛错。默认供应商改为
按 `AiTaskKind` / 媒体 kind 声明（不再按节点类型声明，消除双真值），模型推导
统一收进 `route-provider-defaults.ts` 的 `providerDefaults()`，设置页展示与
实际执行调用同一份推导。`model-routing.test.ts` 新增三条断言：全部
`DIRECTOR_NODE_TYPES` 都能解析出 Director 会话模型；媒体泳道节点会话绑定文本
路由而非 TTS/ASR 路由；展示模型必须等于执行模型。真实链路验证见对应提交记录
（项目 bd2c8979 的 5 个 shot-sfx + 5 个 shot-subtitle 节点从 failed 转 succeeded，
产物 content_hash 与磁盘字节核对一致）。

---

## 5. 模式 D：异步媒体未就绪被当成产物损坏

**症状**：FABRICATE 或 ASSEMBLE 报 `audioManifest` / `audioAllocation` 合同校验失败，
让人以为产物损坏，实际只是配音还没生成完。

**真实事故**：配音是异步链（INGEST 成功后才排队合成），`director-ingest-audio` 尚未存在时，
旧实现回落去读只含 `scriptUnits` 的 `director-ingest`，再用音频 schema 硬解析。

**规则**：

- 读取异步媒体产物必须 `safeParse` 后给出**明确的「尚未就绪」错误**，
  不能把文本产物丢给音频 schema 硬解析。
- 「尚未就绪」的类别是 `MEDIA_NOT_READY`，`retryable=true`，文案要说明配音是异步生成的。
  它的文案里含「缺少」，所以在 `MESSAGE_RULES` 里必须排在「上游产物缺失」规则**之前**。
- 文本主链不得因为音频未就绪而阻塞：SHOT_SPEC 只绑定来源文本，不得编造时长。

**真实事故（终片变体）**：异步配音已经成功写出 `director-ingest-audio`，但
`media-assembly-loader.ts` 仍只选择文本期的 `director-ingest`，导致导出 readiness
错误报告「项目 渲染产物无效」。同一项目的 5 个分镜视频、旁白和字幕都完好，
项目级导出在 51ms 内失败，证明失败发生在应用内装配输入选择，不在 ffmpeg。

**已落地护栏**：终片装配优先选择 `director-ingest-audio`，只对历史同步项目回退
`director-ingest`；`media-assembly-loader.test.ts` 同时锁定优先级与历史回退。
真实项目 `bd2c8979-b6b0-4a3a-b2bb-a1f3a6395568` 已验证项目导出作业成功，
FINALIZE `export` 节点从 `idle` 到 `succeeded`，最终 MP4 的数据库哈希与磁盘字节一致。

---

## 6. 模式 E：fixture 退化成窄形状

**症状**：单测与 pg 测试全绿，真实运行 100% 失败。

**真实事故**：所有 script unit fixture 都写成 `{ unitId, text }`，恰好绕开了
真实 INGEST 产物里的 `order`；模式 A 的 bug 因此存活到线上。

**音频变体**：`runtime-repository.pg.test.ts` 用 `[1, 2, 3]` 冒充 MP3，
严格 MPEG 帧头检测落地后 Postgres 集成门禁失败。测试所声称的容器类型也属于合同，
不能用任意字节绕过真实解析器。

**规则**：

- 阶段输入 fixture 必须使用**真实产物形状**：可选字段能填就填满，尤其是提示词里
  明确要求模型输出的字段。
- 断言「能跑通」时优先用真实链路能产出的最大合法对象，而不是最小对象。最小对象只用于
  「必填字段缺失必须失败」这类反向断言。
- 一份 fixture 只在一个地方定义，多个测试复用；不要在每个测试文件里各写一份窄版本。

**已落地护栏**：`mp3.fixture.ts` 提供可验证的最小连续 MPEG1 Layer III 帧，
`measure.test.ts` 与 `runtime-repository.pg.test.ts` 共用同一份真实形状。

---

## 7. 模式 F：dev server 持有旧模块

**症状**：代码已修好、测试已绿，重试节点仍然报同一个旧错误。

**真实事故**：修好 SHOT_SPEC 后第一次重试仍失败，报文与修复前逐字相同。
原因是长驻的 `next dev` 进程持有队列 handler 的旧模块实例，HMR 没有替换它。
`taskkill /PID <pid> /F` 重启后同一个节点立刻成功。

**规则**：改动 queue handler、stage runner、模型路由或任何被 `initQueue` 持有的模块后，
必须重启 `pnpm dev` 再验证。用真实节点状态变化（`failed` → `succeeded`）作为证据，
不要用「代码看起来对了」代替。

---

## 7.1 模式 G：先登记可变文件，后续写入让产物哈希失真

**症状**：节点与业务产物均成功，但 `artifacts.size_bytes` / `content_hash` 与
`storage_key` 当前字节不一致；会话产物尤其明显，数据库常记录一个很小的初始文件。

**真实事故**：stage runner 创建 Pi JSONL 会话后立即登记 `pi-session` artifact，
此时文件只有初始化元数据；随后模型消息持续 append 到同一路径。一次全库核对中，
803 个 `pi-session` 草稿里有 802 个与磁盘不一致，唯一一致的是修复后新跑的会话。

**规则**：

- 可追加文件、临时文件和仍由外部进程持有的文件不得提前登记为 artifact。
- `size_bytes` 与 `content_hash` 必须在生产者关闭/完成后从实际字节计算。
- 失败会话也要先关闭再登记，保证诊断证据完整；登记失败作为清理错误加入原始失败链，
  不得悄悄吞掉。

**已落地护栏**：`stage-runner.ts` 在成功与失败路径都先关闭 Pi 会话，再调用
`registerArtifactPointer`；`stage-runner.test.ts` 断言 `close → pointer` 顺序。
真实 FINALIZE 重生成后，新 `pi-session` 的大小 26,173 字节，数据库与磁盘 SHA-256
完全一致。历史 802 条均为本地 draft，保留为事故证据，未伪造回写旧哈希。

---

## 7.2 模式 H：失败只有「重试到死」一条出路

**症状**：单个节点反复失败（模型不稳定、素材异常、进程中断）后，整条流水线卡死：
用户只能无限重试或弃片，没有受控的降级出路。

**真实事故**：进程中断后 attempt 永久停在 `running`（僵尸任务）；模型侧间歇性
失败靠人工反复点重试；单个 shot 环节持续失败时项目无法出片。

**规则**：容灾护栏必须分四层，每层职责不重叠：

1. **进程中断自动回收（阶段 1）**：`task_attempts` 携带 `lease_expires_at` /
   `visible_at` 租约；`lease.ts` 周期性把过期 `running` attempt 收尸为
   `TASK_INTERRUPTED` 并重新可见。后台调用必须用 `runInAuthContext` 包住
   workspace 上下文，否则 `currentWorkspaceId()` 直接抛错。
2. **自动重试 + 预算闸门（阶段 2）**：`retry-policy.ts` 的
   `assertEnqueueRetryBudget` 限制同一节点的重试次数；耗尽后落到
   `RETRY_BUDGET_EXHAUSTED`（`retryable=false`，文案引导用户选择跳过）。
3. **人为跳过（阶段 3）**：`skipped` 是一等节点状态，仅限可降级交付的节点
   类型（`shot-codegen` / `shot-sfx` / `shot-subtitle` / `shot-qa`，
   `SKIPPABLE` 全集映射 + 全集遍历断言，见模式 C），仅限 `failed` / `stale` /
   `cancelled` 状态。媒体节点跳过记为 `output-degradation`，验收节点跳过记为
   `qa-waiver`；后者表示「未验收」而非通过。跳过必须留下可审计证据
   （`node-skip-marker` 产物 + `skipMeta.reason/kind`），下游推进把 `skipped`
   视为前置满足；正常导出继续阻断，只有用户显式确认的降级导出可在
   `final-mp4-degraded-manifest` 如实登记占位与未验收泳道，不得宣称完全成功。
4. **Provider 熔断 + 显式备选降级（阶段 4）**：`provider-breaker.ts` 按
   provider 独立计数（连续失败 ≥3 次 open 5 分钟，窗口后 half-open 单次
   试探）；记账**单一收敛点**在 `pi-session.ts` 的 run 结果处，只有外部
   模型调用成败才计入，RouteContractError 等内部矛盾不得污染计数
   （模式 B）。降级只在用户显式配置了 `fallbackProvider` 且备选可用时
   发生（默认无备选，绝不擅自换模型），降级事实经 `degradedFrom`、
   routeLabel 与 `provider_fallback` 日志可追溯；主备均不可用落到
   `PROVIDER_FAILED`（`retryable=true`），不回显 provider 原始错误。

四层的诊断口径：先看 attempt 是否被租约回收（`TASK_INTERRUPTED`），再看重试
预算是否耗尽（`RETRY_BUDGET_EXHAUSTED`），再看是否熔断降级（`provider_fallback`
日志 / routeLabel 带备选标注），最后看节点是否被人为跳过
（`status='skipped'` + `skipMeta` + `node-skip-marker`）。四者互斥，不得用
同一错误码或同一状态混叙。

**已落地护栏**：阶段 1 见 `lease.ts` 与迁移 0005；阶段 2 见 `retry-policy.ts` /
`attempt-completion.ts`；阶段 3 见 `skip.ts`（`skipNodeAction`）、
`skip-policy.ts`（`SKIPPABLE` 全集断言）与 `/api/director/stage` 的
`intent=skip` 合同（routing.md §4.1）。`skipped` 只能由用户显式请求进入，
自动链路（autopilot / 自动重试）永远不得自行跳过节点。阶段 4 见
`provider-breaker.ts`（红线：纯内存单实例假设，多实例部署必须落库）、
`model-routing.ts` 的 `degradeToFallback` 与 `fallback-provider-store.ts`
（配置说明见 docs/configuration/model-routing.md）。

---

## 7.3 模式 I：复合队列丢失 attemptId，内部前置失败污染 Provider 熔断

**症状**：FABRICATE 切换多个模型或供应商仍全部失败；第一次显示具体
`Director 模型调用失败（provider/model）`，同一供应商连续失败三次后统一变成
「AI 服务暂时不可用」。看起来像多个外部服务同时故障。

**真实事故**：`render-shot` 是一个复合作业，先在 Next 进程内执行 Director
FABRICATE，再调用渲染 worker。通用 `director-stage` handler 已把 `job.id` 传给
`runStage`，但 `render-shot → fabricateShot → createStageRunner` 这条旁路没有传递
同一个 attempt id。托管计费流因此在出网前抛出「缺少可审计的 attemptId」；
失败会话的输入/输出 token 均为 0，attempt 在 0.1–1.9 秒内结束，证明没有调用模型。
Pi Agent 把这条内部错误压成 `errorMessage` 后，旧会话收敛逻辑又无条件调用
`recordProviderFailure`，把 StepFun 与 MiMo 分别熔断。切换模型只是在重复触发同一个
内部上下文缺口。

**规则**：

- 复合队列中的子阶段必须继承父 attempt 的真实 id；禁止在子阶段省略、伪造或另建
  attempt id。凡 handler 已持有 `QueueJob`，跨层调用必须显式传 `job.id`。
- 「Agent 出现 errorMessage」不等于「Provider 已经被调用」。计费预留、审计、
  路由授权等出网前失败必须保留原始错误类型，并在 Provider 熔断记账前短路。
- 熔断失败计数只允许来自已经开始的外部调用。token 为 0、无 HTTP 状态且耗时极短时，
  必须先检查调用前置链，不能先归因于供应商。
- 出网前内部不变量失败使用 `INTERNAL_PREFLIGHT_FAILED`，`retryable=false`；
  用户文案只说明内部执行前置检查失败，不回显 attempt id、凭据或原始上下文。

**已落地护栏**：`render/queue-handler.ts` 把 `job.id` 传入 `fabricateShot`，
后者继续传给 `createStageRunner`；`queue-handler.test.ts` 锁定这条三参数调用。
`director-billing-stream.ts` 在调用 Provider 前捕获 preflight failure，
`pi-session.ts` 优先抛回该原始错误而不进入 Provider 失败记账；
`workflow-error.test.ts` 锁定内部前置失败不可重试且不得显示为 Provider 故障。

---

## 7.4 模式 J：长模型调用被短租约误回收，并遗留托管计费预留

**症状**：修复模式 I 后，FABRICATE 不再秒失败，`ai_invocations` 也出现真实的
`provider/model` 与 `running/reserved` 记录；但模型长时间没有终态事件时，父 attempt
先变成 `TASK_INTERRUPTED`，调用记录仍永久停在 `running/reserved`。这不是模型切换
失败，而是队列租约、模型超时和计费补偿三个时钟没有形成闭环。

**真实事故**：MiMo FABRICATE 调用已完成托管预留并进入上游，Pi 会话不再出现
「缺少 attemptId」，证明模式 I 已修复；但上游超过原 2 分钟租约仍未产生终态事件，
心跳未能在这次 Next dev 运行中把租约续到完整执行窗口。约 4 分钟后清扫器把 attempt
回收为 `TASK_INTERRUPTED`。旧实现既没有给 `streamSimple` 显式超时，也保留 SDK
内部重试；清扫器只收尸 attempt/run/node，不处理其 `ai_invocations`，因此额度预留
失去归属并永久悬挂。

**规则**：

- 单次 Provider 调用必须有短于所属队列阶段执行上限的显式硬超时；SDK 内重试必须
  关闭，由队列的统一重试预算负责，禁止形成「SDK 重试 × 队列重试」乘法。
- claim 与续租写入的租约必须覆盖该 `kind` 的完整合法执行窗口，再加至少一个清扫
  间隔。心跳用于延展活跃任务，不能把正确性建立在短进程内定时器永不失效的假设上。
- 每轮僵尸清扫都必须补偿检查：父 attempt 已非 `running`，而托管 invocation 仍是
  `running/reserved` 时，按 `usageStatus=unavailable` 终态结算。该补偿必须幂等，
  并能修复重启前已遗留的孤儿记录。
- 进程中断后无法证明 Provider 是否产生用量，沿用计费合同以最大预留结算；不得
  悄悄释放而低报，也不得保留永久预留。

**已落地护栏**：`director-billing-stream.ts` 把 Provider 调用封顶为 4 分钟并固定
`maxRetries=0`；`lease.ts` 以 `executionTimeoutMs(kind) + SWEEP_INTERVAL_MS`
计算 claim 与续租截止时间；同一清扫周期动态调用
`reconcileOrphanedManagedInvocations`，把父 attempt 已终态的孤儿预留幂等收敛为
`failed/settled/unavailable`。单测锁定超时与重试所有权，Postgres 测试锁定租约
窗口、孤儿补偿和额度账本归零。

---

## 7.5 模式 K：静态确定性门禁放过语法错误，重试永久复用坏 HTML

**症状**：FABRICATE 模型调用成功且 `director-fabricate` 哈希与磁盘一致，随后
渲染报「shot 缺少 window.__CVC_RENDER__ runtime」。直接查看 HTML 明明能找到
`window.__CVC_RENDER__` 字样；同一节点的自动重试又在数秒内连续报相同错误。

**真实事故**：产物中的 GSAP 兼容层少了一个闭合花括号，Chromium 在执行第一行
脚本时抛 `SyntaxError: Unexpected token ':'`，所以后面的 runtime 赋值永远没有
执行。旧 `inspectFabricateSource` 只扫描确定性禁词、viewport 与根画布，不解析
JavaScript；字符串合同因此误判为通过。首次失败后，`hasFabricateArtifact` 又把
同一 draft 当作可复用缓存，队列重试从不重新生成源代码。

**规则**：

- `deterministic-html` 提交门禁除静态确定性外，必须解析全部内联 JavaScript，并
  检查 `window.__CVC_RENDER__@v1 + seek(frame,fps)` 静态合同；语法错误必须在
  artifact 写入前进入既有两次模型修复回路。
- Chromium runtime admission 仍是动态真值，不能被静态门禁替代；脚本执行期错误、
  runtime 缺失、版本或 seek 不匹配均由 admission 发现。
- 动态 admission 已证明源代码无效时，最新 draft `director-fabricate` 必须转为
  `rejected`。后续查询不得返回 rejected 版本，自动重试必须重新 FABRICATE。
- approved / released Artifact 不可原地拒绝；若该异常发生在不可变版本，必须失败
  闭合并通过新版本修复，禁止覆盖原字节。

**已落地护栏**：`fabricate-runtime-contract.ts` 使用 Node 解析器检查全部内联脚本
与 runtime v1；`write-artifact.ts` 把结果并入 `deterministic-html` 门禁。
`RenderShotRepository.rejectFabricateArtifact` 只把最新 draft 转为 rejected，
`findFabricateArtifact` 排除 rejected；handler 与入队 admission 两条失败补偿路径
都会先拒绝坏源，使下一次队列重试重新生成。单测与 Postgres 测试分别锁定语法拒绝、
runtime 失败补偿和 rejected 版本不再命中。

---

## 7.6 模式 L：ASR 毫秒时长直接进入整数计费原子，字幕三通道同时失败

**症状**：镜头代码与 MP4 已成功，下游三个 `shot-subtitle` 仍同时失败；UI 只显示
上游合同无效，`task_attempts.failure.message` 的服务端真值为
`invalid audio_second usage`。切换文本模型或重试字幕都没有意义。

**真实事故**：音频探针按毫秒测量，字幕 ASR 把 `durationMs / 1000` 作为实际用量，
因此常见值是带小数的秒数。费率表的 `price` 只接受安全整数；预留估算已经
`Math.ceil`，实际结算却遗漏同一归一化，Provider 成功返回后反而在本地结算阶段
失败。三个镜头共享同一计费函数，所以同时复发。

**规则与护栏**：音频秒以整秒为最小计费原子，预留和实际结算都必须先验证有限、
非负，再向上取整；token 与字符仍保持整数合同。`rate-card.ts` 以唯一
`wholeAudioSeconds` 同时归一化 estimate/actual，测试锁定 `3.001s → 4s`，并继续
拒绝负数与非有限值。父 attempt 已终态时，模式 J 的补偿清扫负责收敛旧版本遗留的
`running/reserved`，不得留下额度悬挂。

---

## 7.7 模式 M：RPM 限流被普通重试与熔断放大

**症状**：多个镜头同时进入 Director / FABRICATE 后，StepFun 返回 HTTP 429；节点立即标红，
普通自动重试又在同一速率窗口内继续出网，最终把一次可恢复的流量整形问题放大成批量失败，
甚至推动 Provider 熔断。切换到额度更高的模型后链路正常，容易被误判成模型兼容性问题。

**真实事故**：工作流的 `director-stage=12` 只限制本机 CPU 作业并发，不代表供应商 API 额度。
StepFun 当前账户的约束是 `5 RPM`；并发、RPM、TPM 是三个独立维度。Autopilot 一次发现多个
可执行节点后，旧实现会让它们直接同时出网，没有按共享凭据预留速率槽位。429 随后被当成普通
Provider 失败，既消耗重试预算，又污染连续失败计数。

**规则**：

- 出网前必须按真实共享凭据进入 Provider 调度器。BYOK 的键为
  `workspace + provider + credential fingerprint`；平台托管凭据按 provider 跨 workspace
  共享预算。不得把本机 lane 并发数当成外部 RPM。
- 并发、RPM、TPM 分开配置和记账。未知 BYOK 额度使用保守默认，并从真实 429 学习冷却窗口；
  不得把“5 RPM”写成“并发 5”。
- 429 优先遵循 `Retry-After`（秒数或 HTTP 日期），缺失时按滚动窗口计算下一可用时间并加入
  小幅抖动。等待 attempt 必须是 `superseded -> queued`，节点保持 pending/queued，
  不计普通重试预算、30 分钟失败预算或熔断失败次数。
- 单任务累计限流等待最多 15 分钟；超过后才终态化为 `PROVIDER_RATE_LIMITED`。
  401/402/403/429/451、平台内部错误都不得推动熔断；只有真实 5xx、网络故障与上游超时计数。
- 等待态使用 `executionNotice` 的安全投影，不弹失败对话框、不显示红色失败状态、不建议跳过
  关键入口节点。用户可以等待、切换模型或取消等待，但系统不得擅自切换 Provider。
- Provider 原始响应正文只能作为瞬时内部 cause；数据库、Artifact、浏览器响应、日志与 UI
  只允许结构化 `WorkflowFault` 和安全字段。日志只记录 referenceId、provider、model、
  status、stage、attemptId、duration 与 retryAt。

**已落地护栏**：`provider-dispatch.ts` 使用 PostgreSQL advisory lock 原子预留共享预算，
`attempt-completion.ts` 将 429 延后为新 queued attempt，`provider-breaker.ts` 只统计真实外部
故障；`workflow-fault.ts`、`workflow-fault-display.ts` 与阶段对话框共同提供 v2 安全投影。
PostgreSQL 测试锁定滚动 60 秒最多 5 次、共享托管预算、`Retry-After` 两种格式、重启后续跑、
15 分钟终态上限和取消等待。迁移 journal 还必须保持 idx 与时间戳严格递增，并在迁移后核对
目标表真实存在；否则 Drizzle 可能报告成功却因 journal 顺序跳过新 SQL。调度租约的创建、
过期判断与释放时间统一使用 PostgreSQL 时钟，禁止混用应用时钟与数据库时钟导致租约提前过期。

---

## 7.8 模式 N：降级确认被恢复入口绕过，FINALIZE 在终片产生前执行

**症状**：用户跳过一个可降级镜头或验收节点后，全局导出节点在 `FINALIZE` 阶段快速失败，
UI 投影为未知问题并连续重试；数据库没有 `export-project` attempt，也没有 `final-mp4`，
但同一个 Director 节点出现多次几十毫秒级失败。

**真实事故**：自动推进会先调用项目合成，再排队 Director `FINALIZE`；旧的节点恢复入口却直接
排队 `FINALIZE`，绕过了导出就绪判断、显式降级确认和 `final-mp4` 生成。运行时随后抛出
「项目尚无 final-mp4 产物」，文本分类器未识别「尚无」，把业务前置条件错误降成了可重试的
`STAGE_FAILED`。手动 `/api/render/export` 即使成功生成终片，也没有续接全局最终审阅，
因此导出产物与工作流完成状态长期分叉。

**规则**：

- 自动推进、节点恢复/重新执行、用户确认降级导出必须进入同一个导出终结协调器；禁止任何入口
  直接对 `global:export` 排队 `FINALIZE`。
- 可降级但未确认是一等状态 `blocked`，并写安全 `workflowBlock`；它不满足下游、不创建
  Director attempt、不进入普通自动重试，恢复动作为 `confirm_degraded_export`。
- 降级确认必须绑定当前导出输入、占位镜头和 QA 豁免范围的指纹；服务端重算不一致时返回 409，
  不得用旧确认执行新范围。
- `final-mp4` 与交付清单成功登记后，才可按最终视频哈希幂等排队一次 `FINALIZE`。续接失败不得
  删除或覆盖已经登记的终片；输入指纹一致时只补最终审阅，输入变化才重新合成。
- 「尚无 final-mp4」必须是类型化、不可普通重试的前置条件故障；同一次故障的节点投影、
  `task_attempts.failure` 与结构化日志共用一个 referenceId。
- 历史错误只允许在启动、恢复、节点操作或导出命令中窄范围幂等协调；GET 查询不得暗中改状态，
  不得批量改写旧 Artifact、skip marker 或 attempt。

**验收证据**：等待确认期间全局导出节点为 `blocked` 且 Director attempt 增量为零；确认后只有
一个 `export-project`，真实生成 `final-mp4` 与降级清单，再由同一终片哈希续接一个
`FINALIZE` attempt。最终 UI 显示「已完成 · 降级交付」，数据库、磁盘与 HTTP 下载哈希一致。

---

## 8. 工作流类改动的提交前清单

在 `AGENTS.md` §8 的通用门禁之外，涉及本文覆盖的链路时补做：

- [ ] 改动的合同是否已有 SSOT？有则复用，无则**只建一处**（模式 A）。
- [ ] 是否新增了「不支持 / 不能 / 未知」的硬抛？现有节点类型里是否有正在走这条路的（模式 C）。
- [ ] 是否改了 `Record<CanvasNodeType, …>` / `Record<PipelineStage, …>`？是否补了全集遍历断言（模式 C）。
- [ ] 新的失败路径落到哪个 `WorkflowErrorCode`？`retryable` 是否诚实（模式 B）。
- [ ] fixture 是否是真实产物形状（模式 E）。
- [ ] 验证时是否重启过 dev server，并用节点状态与产物哈希作证据（模式 F）。
- [ ] artifact 指向的文件是否已经停止写入，哈希是否在生产者关闭后计算（模式 G）。
- [ ] 新增的失败出路是否落在四层护栏之内（租约回收 / 重试预算 / 人为跳过 / 熔断降级），跳过语义是否留下可审计证据且不被自动链路滥用，熔断记账是否只计外部故障（模式 H）。
- [ ] 复合队列是否把父 `job.id` 贯穿到所有需要审计/计费的子阶段；出网前失败是否保留原始类型并绕过 Provider 熔断（模式 I）。
- [ ] Provider 硬超时是否短于阶段执行上限，SDK 内重试是否关闭；租约是否覆盖完整执行窗口，父 attempt 终态后是否仍存在 `running/reserved` 孤儿调用（模式 J）。
- [ ] FABRICATE HTML 是否实际通过 JavaScript 解析与 Chromium runtime admission；动态证明无效的 draft 是否转为 rejected，自动重试是否会重新生成而非复用坏缓存（模式 K）。
- [ ] TTS 字符与 ASR 音频秒是否按各自计费原子归一化；音频探针的小数秒是否在预留和实际结算两条路径保持一致（模式 L）。
- [ ] Provider 并发、RPM、TPM 是否按共享凭据分别建模；429 是否只延后且不消耗普通重试/失败预算/熔断计数，等待上限与取消路径是否可恢复（模式 M）。
- [ ] Provider 调度迁移的 journal 是否严格递增且目标表真实存在；租约创建、过期判断与释放是否使用同一数据库时钟（模式 M）。
- [ ] 自动推进、节点恢复和显式降级导出是否共用唯一终结协调器；等待确认是否为 `blocked` 且零 Director attempt，终片登记后是否只续接一次最终审阅（模式 N）。
- [ ] 每次真实 Provider 出网是否恰好对应一条 `ai_invocations`；出网前失败是否 release 且不进入调用量，fallback/重试是否各自独立记录。
- [ ] `pipeline_runs.requested_by_user_id` 是否由用户入口固化，并在后台领取、重试、续接中保持不变；是否存在被 `SYSTEM_USER_ID` 覆盖的路径。
- [ ] Provider 耗时是否由进程单调时钟计算并写入 `provider_duration_ms`；是否错误使用应用与数据库墙钟差值。
- [ ] 账本与公共投影是否都未持久化或返回 Prompt、消息正文、Tool 参数、凭据、原始 Provider 错误、隐藏推理、成本、哈希或内部调用 ID。
- [ ] 真实产物证据：`artifacts.content_hash` 与磁盘字节 SHA-256 逐条核对一致。

真实证据的取法示例：

```powershell
docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -A -t -F "|" -c `
  "select content_hash, storage_key from artifacts where project_id='<projectId>' and kind='<kind>'" |
  ForEach-Object {
    $parts = $_ -split '\|'
    if ($parts.Count -eq 2) {
      $actual = (Get-FileHash -LiteralPath (Join-Path ".data/artifacts" $parts[1]) -Algorithm SHA256).Hash.ToLower()
      "match=$($actual -eq $parts[0]) $($parts[1])"
    }
  }
```

---

## 9. 已知未修项

当前无已确认而未修的代码/文档项。

已修：`shot-sfx` / `shot-subtitle` 无法解析 Director 文本模型（模式 C）、
`DEFAULT_PROVIDER` 与 `media_routes` 双真值（模式 A）、内部路由矛盾仍走文案
规则（模式 B）、文档 `measureMp3` 漂移、队列初始化全量并行抖动、终片异步音频
读取错误（模式 D）、Pi 会话哈希失真（模式 G）、复合渲染队列丢失 attempt id 并
污染 Provider 熔断（模式 I）、长模型调用被短租约误回收且遗留计费预留（模式 J）
、静态门禁放过语法错误并重复复用坏 HTML（模式 K）、ASR 小数秒导致字幕结算失败
（模式 L）、RPM 限流被普通重试与熔断放大（模式 M）——见各节「已落地护栏」。

---

## 10. 已核对为不存在同类问题的部分

以下是按模式 A / C 逐一核对过的结论，避免重复排查：

- **阶段输入键对齐**：`runtime-artifact-reader.resolveDirectorInput` 六个阶段的返回键
  与对应 prompt 输入 schema 的 `.strict()` 键集合逐一比对一致（INGEST / DIRECT /
  SHOT_SPEC / FABRICATE / ASSEMBLE·score·shot-sfx·shot-subtitle / FINALIZE·export·shot-qa）。
- **嵌套契约**：除已修的 `shotSpecTargetSchema.sourceUnit` 外，其余嵌套结构
  （`scriptUnitSchema`、`shotAllocationSchema`、`audioAllocationSchema`、`audioManifestSchema`、
  `directorShotSchema`）全部直接 import SSOT，无平行定义。
- **shot plan**：运行时用 `passthrough`，模型可以多输出字段而不炸；严格校验只发生在
  `validate_shot_plan` 工具门禁里，职责分离正确。
- **INGEST 旁路字段**：`createProject` 把 `visualTheme` 存在 `payload` 旁路而非
  `directorInput`，且 `stage-prompt.test.ts` 已有反向断言锁死「visualTheme 混进
  directorInput 必须失败」。
- **跨进程渲染合同**：Next 侧 `renderSpecSchema` 只服务当前按节点渲染链；
  `MediaAssemblyPlan` 是 Next 内部终片装配结构。`server/src/server/api.ts` 的
  `/render` 是独立的 legacy URL/capture 请求面，字段与消费者职责不同，并不消费
  上述两个结构；`server/` 未发现对应但分叉的 zod/schema 副本。
- **队列与 Director 补偿链**：逐条核对 admission、入队、FABRICATE、render、
  stage run 与 artifact commit 失败路径；均会转入 `failed` 并写对应
  `directorError` / `renderError`，清理失败通过 `AggregateError` 保留原始错误，
  未发现会把节点永久留在 `idle` / `running` 的旁路。
- **全集映射**：仓库内 `Record<CanvasNodeType, …>` / `Record<PipelineStage, …>`
  包括 route target、node schema、stage metadata、fallback node type、stage output
  与 UI stage colors。所有生产映射都以类型全集作为键；路由语义另有
  `DIRECTOR_NODE_TYPES` 全遍历测试，阶段输出由 `PIPELINE_STAGES` 参数化测试覆盖。
- **异步媒体的其他消费者**：逐一检查 `runtime-artifact-source.ts`、
  `runtime-artifact-reader.ts` 与导出装配。前两者对未就绪音频走 `safeParse` /
  `MEDIA_NOT_READY`；唯一遗漏是终片 `media-assembly-loader.ts`，已归入模式 D。
- **队列初始化并行抖动**：根因不是测试 timeout，而是 `init.ts` 静态加载
  runtime config、聚合 queue index 与 DB schema，并与 runtime config 形成反向导入。
  singleton 与 lane-quota env 现已拆到无 DB 的叶子模块，runtime config 改为初始化时
  动态加载；全量并行测试连续 10 次通过。
