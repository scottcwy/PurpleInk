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

**真实事故**：工作流的 `director-stage` 只限制本机作业并发，不代表供应商 API 额度。
并发、RPM、TPM 是三个独立维度。Autopilot 一次发现多个
可执行节点后，旧实现会让它们直接同时出网，没有按共享凭据预留速率槽位。429 随后被当成普通
Provider 失败，既消耗重试预算，又污染连续失败计数。

**规则**：

- 出网前必须按真实共享凭据进入 Provider 调度器。BYOK 的键为
  `workspace + provider + credential fingerprint`；平台托管凭据按 provider 跨 workspace
  共享预算。不得把本机 lane 并发数当成外部 RPM。
- Gemini、StepFun、MiMo 分别使用 `managed:gemini`、`managed:stepfun`、`managed:mimo`
  独立池；Key 轮换不能产生新池。一家降速不得阻塞另一家。
- 托管池硬滚动 60 秒保护线分别为 900 / 180 / 90，请求发送最小间隔分别为
  80–88ms / 400–440ms / 800–880ms。RPM 与真实在途数分开记账。
- 在途上限从 8 起步、最高 50。最近至少完成 20 次且连续 5 分钟稳定才增加 1；
  真实 429 立即降 25%，503/网络/超时样本率超过 2% 同样降 25%。
- 429 优先遵循 `Retry-After`（秒数或 HTTP 日期），缺失时按 2/4/8/16/30 秒退避并抖动。
  发送前等待不建立计费 invocation：2 秒内由数据库票据分配唯一时间槽并在当前 worker
  等待，更长等待把同一 attempt 原子改回 `queued` 并推迟 `visible_at`。只有真实出网后的
  429 才终结本轮 invocation、supersede 当前 attempt 并创建 `attemptNo+1` 的恢复记录。
- 单任务累计限流等待最多 15 分钟；超过后才终态化为 `PROVIDER_RATE_LIMITED`。
  401/402/403/429/451、平台内部错误都不得推动熔断；只有真实 5xx、网络故障与上游超时计数。
- 等待态使用 `executionNotice` 的安全投影，不弹失败对话框、不显示红色失败状态、不建议跳过
  关键入口节点。用户可以等待、切换模型或取消等待，但系统不得擅自切换 Provider。
- Provider 原始响应正文只能作为瞬时内部 cause；数据库、Artifact、浏览器响应、日志与 UI
  只允许结构化 `WorkflowFault` 和安全字段。日志只记录 referenceId、provider、model、
  status、stage、attemptId、duration 与 retryAt。

**已落地护栏**：`provider-dispatch.ts` 使用 PostgreSQL advisory lock 原子预留共享预算，
`provider-pool-control.ts` 持久化自适应在途状态，`attempt-completion.ts` 区分发送前等待与真实
429，`provider-breaker.ts` 只统计真实外部
故障；`workflow-fault.ts`、`workflow-fault-display.ts` 与阶段对话框共同提供 v2 安全投影。
PostgreSQL 测试锁定三池隔离、硬滚动保护、共享托管预算、Key 轮换、公平轮转、重启后续跑、
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
- [ ] TTS 供应商是否可能用 HTTP 200 返回错误 JSON；写盘前是否同时验证媒体合同并拒绝错误正文（模式 T）。
- [ ] LLM 生成的 HyperFrames HTML 是否在落盘前检查 `<style>` 内的赋值号污染；结构合法不能替代 CSS 可编译性（模式 U）。
- [ ] 流式 Provider 是否除 SDK timeout 外还有本地墙钟硬截止；永不产出事件的流是否会安全结算并释放票据（模式 V）。
- [ ] worker 轮询或视频下载的一次瞬断是否会复用同一 jobId 继续，而不是把已完成渲染判为失败或隐式重建（模式 W）。
- [ ] Provider 并发、RPM、TPM 是否按共享凭据分别建模；429 是否只延后且不消耗普通重试/失败预算/熔断计数，等待上限与取消路径是否可恢复（模式 M）。
- [ ] Provider 调度迁移的 journal 是否严格递增且目标表真实存在；租约创建、过期判断与释放是否使用同一数据库时钟（模式 M）。
- [ ] 分镜租约身份是否同时包含 project 与 work unit；claim 是否只有一套公平顺序且会跳过暂不可准入的队首；停止是否以 execution epoch + 协作取消收敛全部旧作业（模式 R）。
- [ ] 自动推进、节点恢复和显式降级导出是否共用唯一终结协调器；等待确认是否为 `blocked` 且零 Director attempt，终片登记后是否只续接一次最终审阅（模式 N）。
- [ ] 每次真实 Provider 出网是否恰好对应一条 `ai_invocations`；出网前失败是否 release 且不进入调用量，fallback/重试是否各自独立记录。
- [ ] `pipeline_runs.requested_by_user_id` 是否由用户入口固化，并在后台领取、重试、续接中保持不变；是否存在被 `SYSTEM_USER_ID` 覆盖的路径。
- [ ] Provider 耗时是否由进程单调时钟计算并写入 `provider_duration_ms`；是否错误使用应用与数据库墙钟差值。
- [ ] 账本与公共投影是否都未持久化或返回 Prompt、消息正文、Tool 参数、凭据、原始 Provider 错误、隐藏推理、成本、哈希或内部调用 ID。
- [ ] 真实产物证据：`artifacts.content_hash` 与磁盘字节 SHA-256 逐条核对一致。
- [ ] `databaseNow` 等数据库时钟取值是否不依赖业务表有行；返回值是否经过 `instanceof Date` + `getTime()` 有效性双重验证；传入 Drizzle 算子前是否保证可序列化（模式 O）。

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

## 7.9 模式 O：databaseNow 返回非 Date 对象导致全阶段 TypeError

**症状**：INGEST 模型调用成功、`director-ingest` 产物正常写入，但节点仍然报
「执行遇到未知问题」。三次自动重试全部以同一个 TypeError 在数秒内失败，
`errorName` 为 `TypeError`，attempt 耗时 5–11 秒（模型耗时约 5 秒后的
剩余时间全在 post-commit 链路），AI 调用表中对应行状态为 `succeeded`。
UI 投影为 `STAGE_FAILED`（阶段兜底），且同一进程的 dev log 可见
`TypeError: value.toISOString is not a function` 以及重复的
`Failed query: ... workflow_concurrency_leases` 错误。

**真实事故**：`workspace-concurrency-context.ts` 的 `databaseNow` 通过
`sql<Date | string>\`now()\`` 从 `workspace_entitlements` 表获取数据库时钟。
当 ORM 结果映射返回的 `row.now` 既不满足 `instanceof Date`（跨 realm 或
驱动映射异常），又不是可解析的 ISO 字符串时，`new Date(row.now)` 创建出
`Invalid Date` 或非 Date 对象。随后该值被传入 `activePlan` 的
`lte(startsAt, now)` / `gt(expiresAt, now)`——Drizzle 在序列化参数时调用
`value.toISOString()` 失败抛出 TypeError。

该 TypeError 发生在 `commitStageResult` → `materializeShotLanes` →
`registerWorkflowSlotsInTransaction` → `activePlan` 路径，即模型产物
已写入但分镜通道物化尚未提交的事务窗口内。由于外部事务回滚，泳道节点不入
库，节点状态落到 `failed`；自动重试仍走同一条路径，每次都复现。

**规则**：

- 获取数据库时钟使用 `SELECT now()` 无表查询（`transaction.execute`），
  不依赖任何业务表有行。
- `databaseNow` 的返回值必须经过三层防御：`instanceof Date` + `getTime()`
  有效性 → 字符串 `new Date(str)` 有效性 → 兜底 `new Date()`。
- 任何 Date 值在传入 Drizzle `lte` / `gt` 等比较算子前，保证
  `!Number.isNaN(date.getTime())`；否则应提前抛出明确业务错误，
  不应落到阶段兜底的 `STAGE_FAILED`。
- `workspace-concurrency-projection.ts` 内 `sql` 模板中嵌入
  `gt(timestampColumn, dateValue)` 的用法改为显式 `.toISOString()` 字面量，
  避免 ORM/Driver 序列化层的不确定性。
- `in-process-queue.ts` 的 `[workflow-attempt]` 日志必须同时输出
  `errorMessage`（截断 300 字符），确保 TypeError 等非 Provider 错误的
  原始信息可追溯，不再只有 `errorName`。

**已落地护栏**：`workspace-concurrency-context.ts` 的 `databaseNow` 使用
无表 `SELECT now()` 与三层解析防御；`workspace-concurrency-projection.ts`
改为显式 ISO 字符串参数；`in-process-queue.ts` 补齐 `errorMessage` 日志字段。

---

## 7.10 模式 P：并发音频任务被 Provider pacing 拒绝后形成失败或重试重叠

**症状**：INGEST 成功、分镜脚本全部完成，但所有 shot-codegen 永久停在 idle。
配音任务显示 failed；`ai_invocations` 表中第一条 TTS 调用成功（≥ 5s），
同批其余调用全部在 22–50ms 内失败（`failure_kind: 'unknown'`）。
重试三次后终态。`errorName` 为 `ManagedAiError`。

**真实事故**：StepFun TTS 的托管池配置 `minIntervalMs: 400ms`（相邻请求间隔
至少 400ms）。`NARRATION_CONCURRENCY = 4` 个 worker 同时发起 TTS，第一个获取
调度租约成功，其余 3 个被 `nextProviderWindow` 的 pacing 规则拒绝，
抛出 `ProviderDispatchWaitError`。

`managed-audio-billing.ts` 的 `invoke()` catch 块把所有异常——包括
`ProviderDispatchWaitError`——都包装为 `managedUpstreamError`，丢弃了原始的
`retryAt` 与等待原因。队列层本有专门处理 `ProviderDispatchWaitError` 的
调度逻辑（`scheduleProviderDispatchWait`，暂停后按 retryAt 恢复），但被
包装干掉后只能按普通失败做指数退避重试，重试时统一模式再现→
配音终态失败→ `isMediaReady` 永远返回 false→ shot-codegen 永久阻塞。

**后续复发边界**：给旁白 worker 增加 `N * 450ms` 启动错峰只能缓解首波 TTS。
真正的调度预约之前仍有缓存、计费预留与配置读取等异步步骤，后续 unit 可能重新聚拢；
录音转写与旁白又处于独立 queue lane，但托管 StepFun 仍共享同一个 provider scope，
因此 ASR 与 TTS 也会交叉碰撞。若旁白用 fail-fast `Promise.all`，一个 worker 抛出等待
错误后其他 worker 仍继续执行，队列恢复的 attempt 会和旧 worker 重叠。若发送前等待
复用同一 attempt，本轮 `releaseBeforeCall()` 已把计费 invocation 终态化，恢复执行却会
再次命中同一个 invocation id，可能出现 Provider 已成功而账本仍为 released/cancelled。

**规则**：

- `ProviderQueueDeferral` 是队列控制信号而非上游失败，不得经过错误分类、
  `managedUpstreamError`、普通重试或熔断。
- 调度许可必须早于计费 invocation；发送前等待期间不得存在计费预留。
- 禁止用 worker 固定错峰承担 pacing 正确性；所有 TTS / ASR 出网由数据库票据分配
  唯一时间槽。
- 一组旁白 worker 必须先用 `Promise.allSettled` 排空所有已启动 lane；存在多个结果时，
  明确业务错误优先于真实 Provider 故障，调度等待最后投影，避免等待掩盖鉴权等终态问题。
- 发送前长等待复用同一 attempt id 与 attemptNo，只增加安全的 `providerResumeCount`；
  已完成 unit 通过内容寻址 Artifact 复用。
- 调度拒绝必须被工作流投影为安全的 `waiting`，而非 `failed`；只允许展示
  `resumeAt` 与安全 provider label，不得持久化或返回原始 Provider 报文。

**已落地护栏**：Provider admission 先于计费预留；`provider_dispatches` 使用
`scheduled → in_flight → released/cancelled` 票据生命周期。旁白 worker 排空、同 attempt
原地延迟、部分产物复用和安全等待投影由对应 PostgreSQL 与音频测试锁定。

---

## 7.11 模式 Q：数据库与应用时钟混用，让亚秒 pacing 变成分钟级重试风暴

**症状**：分镜脚本已全部成功，但代码生成在数分钟后才创建；旁白或字幕产生几十到
上百个 `superseded` attempt，最后又会自行成功。字幕节点每次都有一次成功的文本
模型调用，随后 ASR 立即取消或释放，UI 在等待与失败之间反复闪动。工作区并发条仍可能
显示“未排队”，因为它不投影 Provider 调度窗口。

**真实事故**：PostgreSQL 时钟比 Node 进程快约 60 秒。Provider 调度器用数据库
`reserved_at` 计算 `retryAt`，却用应用 `Date.now()` 判断该窗口是否仍在未来。
已经相对数据库过期的 pacing 时间因此仍被当成等待写入 `visible_at`；队列领取又使用
PostgreSQL `now()`，所以新 attempt 立即被重新领取并再次撞到同一等待。一次四镜项目
实际产生 96 个旁白 attempt（95 个 superseded）以及 74 次成功字幕文本调用。

字幕还有第二层放大器：Director 文本产物已经提交后才执行 ASR 副作用。ASR 等待被
Stage Runner 先记为 `failed + directorError`，队列随后再改回
`pending + executionNotice`；恢复 attempt 没有识别已提交的 Director 产物，于是从头
重复文本模型调用。

**规则**：

- 来自数据库的时间戳只能与同一事务读取的数据库 `now()` 比较；pacing、RPM、TPM、
  cooldown、并发租约和队列可见时间禁止混入应用墙钟。
- Provider 等待写入 `visible_at` 时必须由数据库保证它严格晚于当前数据库时间，
  防止时钟漂移、过期 `Retry-After` 或事务耗时制造立即重领空转。
- `ProviderQueueDeferral` 不得经过阶段失败投影。节点应从 `running` 原子转为
  `pending + executionNotice`，同时清理旧 `directorError` / `renderError`。
- 复合阶段在文本产物已提交、媒体副作用未完成时必须留下可恢复检查点。恢复只重试
  未完成副作用，不得再次调用已经成功并提交的文本模型。
- 校准主机时钟只是运维缓解，不能替代代码的单时钟正确性。

**已落地护栏**：`provider-dispatch.ts` 把事务内数据库时间传给
`nextProviderWindow`，`provider-wait-scheduler.ts` 用数据库表达式钳制未来
`visible_at`；Stage Runner 对 Provider 等待不再落失败，并通过节点已提交 Artifact
识别字幕副作用续跑。状态迁移在写入 `executionNotice` 时清除旧失败投影；录音 ASR
入口同样保持 `running`，由队列原子收敛到等待态，不再经过临时 `failed`。

字幕续跑判定曾额外要求 attempt checkpoint 里存在 `providerScopeKey`，已移除：票据化
调度后只有 `deferProviderAttempt`（原地延迟、复用同一 attemptId）会写该字段，而
`scheduleProviderRateLimitWait`（真实 429、新建 attempt）只是继承旧 queueMeta，于是
「是否重复调用文本模型」取决于此前是否恰好发生过一次无关的调度延迟。判定现在只依据
节点投影的 `directorArtifactId` + `outputContentHash` 是否对上本 run 提交的产物。

另有一处隐式耦合必须一并保住：字幕续跑之所以能复用同一 `attemptId` 而不撞
`(attemptId, invocationNo)` 唯一键，前提是托管音频把计费预留 `begin()` 放在
Provider 许可**之后**（`managed-audio-billing.ts`），因此等待期不产生 invocation 行。
把预留移回许可之前会静默破坏字幕续跑，改动该顺序时必须同时复核本节。

---

## 7.12 模式 R：分镜租约身份碰撞与双重 FIFO 形成永久队首阻塞

**症状**：23 分镜项目在套餐上限 20 或 50 时都显示“0 个执行、全部排队”，倒计时结束
后又从头计时；停止自动推进后旧项目仍占用队列，新项目无法执行，项目删除也持续返回
“仍有执行中作业”。偶尔手动重启节点或等待很久后又会莫名推进。

**真实事故**：

- `workflow_concurrency_leases` 只以 `(workspace_id, work_unit_key)` 标识租约，不同项目
  都使用 `S001` 时会互相覆盖；
- attempt claim 按 attempt FIFO，租约准入又按另一套 lease FIFO 裁决。两个顺序相反时，
  队首候选永远无法通过，claim 又不扫描后续候选，形成饥饿；
- 旧“停止自动推进”只关闭未来协调，不取消已经 queued/running 的执行；
- 进程退出后历史 `running + lease_expires_at IS NULL` 没有回收条件，永久占用删除守卫
  与运行投影。

**规则**：

- 分镜租约的最小身份必须包含 workspace、project 与 work unit；登记、续租、释放、
  清扫和投影查询都不得只凭 `S001` 修改。
- 公平顺序只有 attempt 一套真值。active lane 后续阶段优先，项目级任务不占分镜槽，
  到期 waiting lane 再按 attempt 创建时间领取；暂不可准入候选不得阻断有界扫描窗口。
- 容量为零占用时首个可执行分镜必须立即准入；启动间隔只能延后第二个及以后分镜。
- 项目停止必须以 `execution_epoch` 栅栏旧作业，并对 running attempt 使用协作取消；
  “关闭 autopilot”不等于“停止项目”。
- 清扫器必须覆盖过期租约、取消后失联、失效代次 queued 作业，以及超过 20 分钟的历史
  null lease 僵尸；正常仍有心跳的新 running 作业不得误收。

**已落地护栏**：migration 0021 将租约主键升级为三列并回填 attempt
`work_unit_key`；队列领取在 workspace advisory lock 与 `FOR UPDATE SKIP LOCKED`
下按单一优先级扫描；统一项目停止服务原子关闭 autopilot、递增执行代次并收敛
attempt/run/ticket/lease；worker 通过 `AbortSignal` 协作取消，Artifact 与节点写回
使用代次栅栏；清扫器补齐 null lease 与失效代次回收。PostgreSQL 回归测试锁定跨项目
`S001`、23/20 与 23/50 首批准入、反序 FIFO、释放后续推、重复停止及迟到完成竞争。

---

## 7.13 模式 S：产物血缘用 artifactId 强绑定，重跑同字节产物即判失效

**症状**：分镜、旁白、字幕节点全部成功，导出却持续被阻塞，UI 显示「S00x 产物无效」
或「S00x 缺字幕」。重跑字幕节点后能好一阵，过一段时间又复现。字幕内容本身完全正确。

**真实事故**：`media-assembly-shots.ts` 的 `subtitleValid` 用
`lineage.sourceAudioArtifactId === narration.artifactId` 判定字幕与旁白同源，而
`artifacts` 提交（`features/artifacts/commit.ts` 的 `insertArtifactVersion`）**没有
content-hash 去重**：每次提交一律 `version + 1` 并生成新 `artifactId`，即使
`storageKey` 与 `contentHash` 完全一致。模式 Q 的等待风暴期间旁白被反复重跑，真实
项目上 `narration-audio` 版本链已达 96 层，于是每一次重跑都把上一版字幕判成
`artifact-invalid`。

而且不会自愈：`canvas/status.ts` 的 `isStaleInTransaction` 只比对**画布边上游节点**的
`outputContentHash`，旁白是侧生产物、不在依赖集内，所以 `shot-subtitle` 不会转
`stale`、不会自动重跑，阻塞只能靠人工干预解除。

同一个函数里当时并存两套口径：`narrationValid` 用内容哈希（`manifest.sha256`）比对，
宽容且正确；`subtitleValid` 用行 ID 比对，脆弱。

**规则**：

- 跨产物的同源判定只能基于内容标识（内容寻址的 `storageKey` 或 `content_hash`），
  不得使用 `artifactId` / `version` 等行身份。版本链会因重试无限增长，行身份必然漂移。
- 内容寻址键要成为内容等价证明，必须保证「同键不再重新生成字节」。旁白满足这一点：
  `narrationAudioKey` 由 `(engine, voice, text)` 求 SHA-256，`reuseNarrationAudio`
  命中即复用字节、跳过合成。新增内容寻址产物时必须同样保证，否则改用 `content_hash`。
- 同一个校验函数里不得对不同产物使用宽严不一的口径；宽的那一套通常才是对的。
- 侧生产物（旁白音频等）不在画布边上，`stale` 机制覆盖不到。依赖它们的节点必须用
  内容口径校验，不能指望失效传播来兜底。
- 产物版本链深度与重试次数成正比，会同时拖慢项目删除（见 `project-deletion.ts` 按
  进展收敛的删除循环）。修限流与重试放大，也是在修这里。

**已落地护栏**：`subtitleValid` 只比对 `sourceAudioKey`，`sourceAudioArtifactId` 仍
写入血缘供追溯但不再当门禁。`media-assembly.test.ts` 锁定双向行为：旁白重跑成同字节
新版本时字幕仍有效；来源键改变时仍然阻塞。

---

## 7.14 模式 T：TTS 用 HTTP 200 返回错误 JSON，错误正文被写成音频

**症状**：旁白合成阶段看似完成了多个 MP3，文件却都只有几十字节；随后
`ffprobe` 在时长测量阶段失败。UI 最终只看到渲染失败，供应商的真实失败点被延后。

**真实事故**：ListenHub 的业务错误仍使用 HTTP 200。额度不足时响应为
`application/json`，包含非零业务码 `26004`；旧客户端只检查 `response.ok`，把正文
直接写成 `.mp3`。真实 URL 工作流因此生成了四个 66 字节伪音频，直到
`measureAudioDuration` 才暴露。

**规则与护栏**：

- 二进制媒体客户端不能只以 HTTP 状态判断成功；必须在写盘前验证响应媒体合同。
- JSON 错误只记录稳定状态或业务码，不写入产物，也不把供应商 message 投影给 UI。
- 供应商不可用时不得生成静音或静默换供应商。替代供应商必须通过显式配置选择。
- worker 的 MiMo 路由与 ListenHub 路由是互斥配置；MiMo 返回值还需通过 RIFF/WAVE
  头校验后才能落盘。
- `tts-runtime.test.ts` 锁定 HTTP 200 错误 JSON 的拒绝、错误正文脱敏，以及 MiMo
  请求合同和 WAV 字节校验。

---

## 7.15 模式 U：LLM 把 JavaScript 赋值写进 CSS，结构校验通过但编译失败

**症状**：网站抓取、旁白和章节生成都成功，HyperFrames `check` 与 `render` 却在
`Compiling composition` 立即失败，报 `<css input>:… Unknown word left=0`。

**真实事故**：LLM 生成的开场章节包含
`#cir1{...;left=0;left:180px;...}`。原校验只检查 composition 属性、时间线注册、禁用
元素与时长，没有验证 `<style>` 中的声明语法，因此把该章节标记为 `source=llm` 并写入
最终项目；模板回落机制完全没有机会接管。

**规则与护栏**：

- LLM 章节进入合成前必须同时通过结构合同与最低 CSS 语法门禁。
- `<style>` 声明起始位置出现 `property=value` 时立即拒绝该章节并使用既有模板回落；
  不在最终项目上做字符串替换，因为无法证明其余生成内容仍语义正确。
- 合法的 `left: 0` 与非法的 `left=0` 由 `chapter-validation.test.ts` 双向锁定。
- 真实工作流验证必须看到 `render_done code=0` 与最终 MP4；`chapters_generated` 不是成功。

---

## 7.16 模式 V：流式 SDK 忽略超时参数，Provider 调用永久停在 running

**症状**：Director 阶段已把 Provider 硬超时设置为 4 分钟且关闭 SDK 内重试，但真实
`shot-codegen` 调用超过 8 分钟后，`task_attempts`、`ai_invocations` 与调度票据仍分别停在
`running`、`running/reserved` 和 `in_flight`。项目停止只能写入取消请求，无法让当前调用
及时确认，直到队列的取消失联清扫器介入。

**真实事故**：`director-billing-stream.ts` 只把 `timeoutMs` 传给 pi-ai 的
`streamSimple`。该参数属于上游适配器合同；当适配器或底层流没有按时终止时，本地
`for await` 会永久等待下一条事件，计费结算、票据释放和 attempt 收敛都无法执行。

**规则与护栏**：

- Provider SDK 的 timeout 只能作为第一层取消信号，不能作为工作流硬截止的唯一保证。
- 出网边界必须用本地墙钟对异步迭代器的每次 `next()` 做总截止竞速；截止后产生安全的
  `ProviderRequestError(kind=timeout)`，并进入既有结算、票据释放与重试语义。
- pi 会把异步迭代器抛错投影成普通 `error` event；计费流必须在该降格发生前把原始
  `ProviderRequestError` 旁路交给会话，由会话以同一对象完成熔断记账和 WorkflowFault
  投影，禁止再从脱敏文案反推错误类型。
- 本地硬截止使用与传给 SDK 相同且已封顶的 `timeoutMs`，不得形成两个不同口径。
- 终止悬挂流时允许尽力调用迭代器 `return()`，但不得等待一个同样可能悬挂的清理 Promise。
- `director-billing-stream.test.ts` 必须包含“上游永不产生事件”的回归测试，并断言
  invocation 以 `timeout` 失败结算，而不是依赖测试框架自身超时。

---

## 7.17 模式 W：长渲染期间一次 worker 瞬断，已完成视频被判为引擎失败

**症状**：worker 的真实日志最终出现 `render_done code=0`、`narration_muxed` 与
`job:done`，本地 MP4 可被 `ffprobe` 正常解析；但 Products 侧 attempt 却以
`WEBSITE_ENGINE_UNAVAILABLE` 失败，项目没有登记任何视频 Artifact。

**真实事故**：网站执行器每两秒轮询内存 Job，但任意一次 `getJob` 或最终
`downloadVideo` 的短暂 `ENGINE_UNAVAILABLE` 都会直接终止整个 10 分钟以上的操作。
该错误不代表 Job 已失败；同一 Job 随后仍可返回 `done`，视频下载也能在数毫秒内完成。

**规则与护栏**：

- 瞬时 `ENGINE_UNAVAILABLE` 是轮询传输故障，不是渲染终态；保持同一个 jobId，在工作流
  总截止内继续轮询，禁止因此新建昂贵渲染。
- 只有明确 `failed/cancelled` Job、不可重试合同错误或总截止耗尽才能终止 attempt。
- 已完成 Job 的视频下载同样允许在总截止内重试瞬断；每次重试前继续检查项目取消信号。
- `ENGINE_JOB_NOT_FOUND` 仍按幂等 requestId 最多重建一次，与瞬时不可用的同 Job 重试分开。
- 回归测试必须分别覆盖轮询瞬断和下载瞬断，并断言 `start` 只调用一次。

---

## 7.18 模式 X：响应字段与进程内 SSE 冒充跨进程执行真值

**症状**：URL 视频后端仍在推进，画布却长期停在第一个“网站自动介绍”节点；点击启动
还会提示“工作流响应缺少 autopilot 状态”。SSE 显示 connected，但刷新页面后节点才变化。

**真实事故**：统一画布把 script 专属的 `projects.autopilot` 当成三类项目的执行状态，
website start 又没有该字段。临时在响应中硬塞 `autopilot=true` 只会制造与数据库相反的
状态。与此同时 `status-bus` 是进程内发布订阅；浏览器与 worker 落在不同 Next 进程时，
连接可以健康但永远收不到另一个进程发布的事件。客户端看到 connected 后还关闭了数据库
轮询，于是后端事实与前端永久分叉。

**规则与护栏**：

- script 的 autopilot 与项目执行状态必须分离；audio / website 不得伪造 autopilot。
- audio 的自动续接使用独立持久门闩，并必须在 ASR 入口成功状态落库前受 attempt /
  execution epoch 栅栏保护地开启；只在进程内调用 `advance` 会留下不可恢复的崩溃间隙。
- stop 必须同时清除 script autopilot 与 audio 续接门闩；重复 stop 不得再次递增 epoch。
- 三类项目的 UI 状态统一从 attempt、节点、Artifact 派生，响应只携带同一快照。
- SSE 只做失效提示；active 项目必须持续用 Postgres 快照对账，不能以 socket open
  代替“收到过最新状态”。
- website 成功必须同时证明 attempt、六节点、质量校验与 approved MP4 一致；缺一项
  投影为 blocked，禁止正式下载。
- 回归测试必须覆盖“连接存在但无事件”的多进程场景，并断言轮询仍推进节点。

---

## 7.19 模式 Y：队列超时只结束等待，旧阶段继续把产物写给新 attempt

**症状**：阶段已经因执行超时进入失败或重试，新 attempt 也已开始，但旧 Provider 调用
稍后返回后，节点又被改成成功/失败，甚至把旧结果登记到新 attempt 名下。启动清扫与
定时清扫同时触发时，还会重复扫描和补偿同一批状态。

**真实事故**：`withExecutionTimeout` 只用 `Promise.race` 拒绝外层等待，没有中止
`registerAttemptController` 为该 attempt 登记的 controller。队列随即释放 lane 并允许
重试，旧 handler 却仍在后台运行。Director 的产物写入会动态解析当前 running attempt，
因此迟到 handler 若没有在写入前检查取消信号，可能错误归属刚启动的新 attempt；其错误
补偿也可能覆盖新 attempt 的节点投影。与此同时 queue 的消费 tick 已有单飞，sweep
仍允许启动调用与 interval 调用重叠。

**规则与护栏**：

- 阶段墙钟超时必须先用同一个 `ExecutionTimeoutError` 中止该 attempt controller，再
  拒绝外层等待；领域 handler 必须在 Provider 返回、Artifact 写入、节点终态和下游推进
  之间检查该信号。
- 已取消的 Stage Runner 只允许尽力关闭本地会话，不得再登记 Artifact、写节点终态/
  错误投影、写流日志或推进下游。
- Artifact 提交继续以 attempt 状态、更新 attempt 与 execution epoch 做数据库栅栏；
  AbortSignal 是及时停止副作用，数据库栅栏是最终一致性保护，两者不能互相替代。
- sweep 与 tick 一样必须单飞；启动清扫未完成时，定时清扫直接跳过该轮。
- 回归测试必须覆盖“Provider 在超时后迟到返回”，断言旧 runner 不调用 Artifact 写入、
  节点终态/错误投影或下游推进，并验证 controller 的 abort reason 与队列超时错误一致。

---

## 7.20 模式 Z：页面脚本运行时错误未拒绝 FABRICATE，渲染重试永久复用坏 HTML

**症状**：FABRICATE 与确定性检查都成功，`director-fabricate` 也已登记；渲染连续三次
返回 `RENDER_FAILED`，但每次都复用同一份 HTML，最终项目失败。直接在 Chromium 打开
产物可见 `ReferenceError`，例如变量被赋值和读取却从未声明。

**真实事故**：静态门禁已经能拦语法错误、runtime 缺失和伪造字体，但无法证明所有
JavaScript 标识符在运行时都有定义。`openFrameCapture` 又没有监听 `pageerror`；脚本
异常后若 runtime 已提前挂到 `window`，admission 仍可能通过。即使异常导致母版根节点
没有创建，几何错误也会被脱敏成普通 runtime admission 失败，`isRenderSourceContractError`
无法识别，补偿不会拒绝坏的 FABRICATE Artifact，自动重试只能重复失败。

**规则与护栏**：

- Chromium 页面从加载到每次 `seek` 都必须监听并 fail-closed 处理 `pageerror`；普通界面
  只返回稳定的“页面脚本执行失败”，不得泄漏生成代码或本地路径。
- `check_determinism` 在 FABRICATE Artifact 提交前必须执行真实 Chromium 加载、母版
  几何与逐帧 `seek` 探测；运行时不合格结果作为同一 Director 会话的安全门禁反馈，
  让模型在既有两次修复额度内修改来源。渲染 admission 仍保留为第二道防线，不能因
  前置探测通过而省略。
- assistant 文本抢救路径没有成功的 `check_determinism` 工具结果，因此必须在 Artifact
  提交前复用同一完整门禁：先执行静态合同，只有静态通过才启动 Chromium；不能只凭
  HTML 首尾形状直接入库，也不能先执行本应由静态规则拒绝的来源。
- 探测必须继承 Director 的取消信号，并为浏览器操作和总流程设置有限截止时间；字体或
  `seek` 的永不结束 Promise 必须安全退出、关闭 Chromium、删除临时来源。页面内部
  `seek` 超时属于可回馈的 source 违规，浏览器启动、协议断连等仍属于基础设施错误。
- 只在浏览器页面内部把 `runtime.seek()` 自身异常转换为 source 合同错误；
  `page.evaluate`、CDP、Chromium 断连等基础设施失败必须原样进入重试，禁止误拒绝有效源。
- runtime 缺失/版本/seek、页面脚本异常、母版几何不匹配都属于生成 source 合同失败；
  即使被 frame-sequence 包装，也必须沿 `Error.cause` 识别。
- source 合同失败必须按本次 `RenderJob.htmlKey` 精确把对应的
  `director-fabricate` draft 转为 `rejected`；禁止按节点重新查询“最新版本”，否则
  旧渲染失败会误拒绝并发生成的新 draft。后续恢复重新 FABRICATE，禁止继续渲染同一坏版本。
- 回归测试必须包含“runtime 与 1920×1080 根节点都存在，但页面脚本仍抛 ReferenceError”
  的真实 Chromium fixture，以及嵌套 cause 仍会拒绝 Artifact 的队列测试。

---

## 7.21 模式 AA：自动入队补偿为 retryable failed，但后台前沿永远不再领取

**症状**：上游节点已经成功、项目 `autopilot=true`、当前没有 active attempt，下游因
一次瞬态入队或 admission 失败停在 `failed`，错误投影明确标记 `retryable=true`；
用户再次点击启动可以继续，但无人值守后台长期没有自动推进。

**根因**：即时 `advancePipeline` 与手动续跑都允许重新领取 retryable failed 节点，
但后台 `listDirectorFrontierCandidates` 只把 `idle/stale` 当成 ready frontier。入队
补偿会按合同把节点转为 `failed`，于是恰好需要自动恢复的节点反而被候选 SQL 永久排除。

**规则与护栏**：

- 后台前沿候选必须包含 `idle/stale`，以及当前有效错误投影明确
  `retryable=true` 的 `failed` 节点；Director 错误优先于 render 错误，与
  `AdvanceRepository` 的读取顺序保持一致。
- 所有自动推进入口都只接受 JSON 布尔值 `retryable=true`；`false`、缺失字段或
  字符串 `"true"` 均保持阻塞，禁止后台猜测重试。
- 候选筛选是项目级信号，节点级推进仍必须独立执行同一门禁，禁止不可重试节点借
  同项目另一条 ready 分支被顺带重新入队。
- 候选仍必须同时满足：全部上游成功/跳过、同 execution epoch 无 active attempt、
  来源专属自动推进门闩开启且在恢复时间窗内。script 使用 `autopilot`，audio 使用
  `director_continuation_enabled`，website 不进入 Director 前沿恢复。
- PG 回归必须同时证明 retryable failed 会被领取，terminal failed 不会进入候选。

---

## 9. 已知未修项

当前无已确认而未修的代码/文档项。

已修：`shot-sfx` / `shot-subtitle` 无法解析 Director 文本模型（模式 C）、
`DEFAULT_PROVIDER` 与 `media_routes` 双真值（模式 A）、内部路由矛盾仍走文案
规则（模式 B）、文档 `measureMp3` 漂移、队列初始化全量并行抖动、终片异步音频
读取错误（模式 D）、Pi 会话哈希失真（模式 G）、复合渲染队列丢失 attempt id 并
污染 Provider 熔断（模式 I）、长模型调用被短租约误回收且遗留计费预留（模式 J）
、静态门禁放过语法错误并重复复用坏 HTML（模式 K）、ASR 小数秒导致字幕结算失败
（模式 L）、RPM 限流被普通重试与熔断放大（模式 M）、databaseNow 非 Date 返回
导致 post-commit TypeError（模式 O）、并发旁白调度等待被包装为上游失败导致
配音永久失败（模式 P）、数据库与应用时钟混用导致 Provider 等待风暴和字幕文本重复
调用（模式 Q）、产物血缘用 artifactId 强绑定导致旁白重跑即判字幕失效（模式 S）
、队列执行超时未中止旧阶段并允许迟到写入（模式 Y）、页面脚本异常未拒绝坏
FABRICATE Artifact（模式 Z）、retryable failed 前沿未被后台恢复（模式 AA）——见
各节「已落地护栏」。

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
