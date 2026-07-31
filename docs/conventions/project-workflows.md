# 项目工作流来源与版本规范

本文是项目来源类型、版本兼容、执行边界、计费、Artifact 与容灾的唯一真值。
它补充 `routing.md`，不替代 Director / 渲染故障规范。

## 1. 来源类型

`projects.workflow_kind` 只允许以下稳定值：

| kind | 用户输入 | 目标工作流 | 当前接线 |
| --- | --- | --- | --- |
| `script` | 文稿 | 既有文稿 → 配音 → 分镜 → 渲染链路 | `wired` |
| `audio` | 用户录音 | ASR → 原音频时间轴 → 复用文稿分镜与渲染，不重复 TTS | 创建与执行 `wired` |
| `website` | 可访问 URL | Playwright 取证 → 网站介绍编排 → 复用成熟生视频系统 | 创建与执行 `wired` |

`workflow_kind` 表达来源与编排族；`workflow_version` 表达该族当前可执行的精确合同。
二者必须成对判断，禁止只比较版本字符串，也禁止由节点形状反推来源。

## 2. 活跃版本注册表

代码唯一注册表是 `src/lib/workflow/project-workflow-registry.ts`。

| kind | active workflowVersion |
| --- | --- |
| `script` | `cvc-v3-foundation|cvc-arch-v3.0.0|fabricate-landscape-1920x1080-v1|landscape-render-1920x1080-v1|node22-playwright1.61.1-ffmpeg-static5.3.0` |
| `audio` | `purpleink-audio-to-video-v1` |
| `website` | `purpleink-website-intro-video-v1` |

`script` 必须精确保留既有 `ACTIVE_WORKFLOW_VERSION` 序列化结果。三族执行器均已接线；
任一族修改节点合同、持久化 Artifact 结构或恢复语义时，只提升该族版本，不连带
修改其他族。

列表只显示 `(workflow_kind, workflow_version)` 与注册表活跃项精确匹配的项目。
详情路由同样按项目行自己的 kind 判断；不匹配的数据标记为 legacy 并保留，不迁移、
覆盖或删除。

## 3. 创建与启动边界

- `POST /api/projects` 按 `kind` 判别联合输入，并兼容既有未携带 `kind` 的文稿 JSON。
- audio 只接受服务端测量后的 MP3/WAV multipart，客户端不得注入对象键、时长、
  采样率或 Artifact ID；website URL 在入库前规范化，最终 SSRF/DNS 守卫仍由 worker 执行。
- 创建响应直接返回事务内生成的 `entryNodeId`；`ingestNodeId` 仅是旧文稿客户端的
  过渡别名，禁止再通过创建后的图查询猜测入口。
- `POST /api/projects/[id]/start` 是统一启动入口，只按服务端已持久化 kind 分派；
  script 复用既有 Director，audio 入队 ASR，website 入队成熟网站视频适配器。
- 启动前必须同时校验项目 kind、来源 kind 与 active workflowVersion；版本写入真实
  pipeline run，并进入 audio / website attempt 的稳定指纹，禁止用当前代码执行旧版本。
- 在 `project_sources` 建表前已存在、且版本仍 active 的 script 项目继续从
  `projects.script` 与既有 `global:script-import` 入口启动；该兼容只适用于 script，
  不为缺失来源的 audio / website 猜造输入。
- audio / website 的 queued / running / succeeded attempt 通过稳定队列指纹复用，
  重复点击不得制造平行执行；failed attempt 仅在用户显式重启时新建；
  队列 attempt id 同时是计费与 Artifact 的真实归属。
- script / audio / website 创建请求共用 `project_creation_requests` 幂等账本。
  script 指纹绑定规范化标题、文稿、主题和视觉风格；audio 指纹由规范化标题、视觉
  设置、实测媒体元数据与上传字节 SHA-256 派生，排除随机 `projectId` /
  `storageKey`。相同 key 并发只提交一个项目；复用原项目时清理本次隔离上传，启动
  失败或客户端等待超时后的重试只启动已创建项目，不得重复创建。
- 复用 succeeded audio attempt 时必须重新推进既有 Director frontier，以恢复 ASR
  成功后下游启动失败；复用 succeeded website attempt 则据实返回 `complete`。
- 创建只负责项目与初始拓扑的原子持久化；启动负责建立真实 run / attempt。
- 营销首页 URL 提交完成接线后必须先创建 `website` 项目，再调用统一启动入口，
  不得继续作为脱离项目账本的下载旁路。

## 4. 复用与主工作流保护

- `script` 拓扑、Director、渲染和 Artifact 合同是基线；新增来源不得推倒或暗改它。
- `audio` 在 ASR 后复用文稿分镜与渲染能力，但保留原音频作为时间与旁白真值，
  禁止再次 TTS。
- `website` 以适配器挂载成熟 worker；阶段投影可以新增，成熟生成内部不得重写。
- 共享能力从公开领域出口复用；禁止第二套账号、额度、项目状态或应用壳。

## 5. 计费与会员

三类项目共享当前 workspace entitlement、会员档位与 `usage_periods` 总额度。
新增工作流不得提高或复制套餐总额。每次真实模型调用必须绑定真实 run / attempt，
采用统一 ExecutionPlan、预留、结算、失败补偿与幂等语义；BYOK 仍按既有资金来源
规则执行。

audio 的 ASR 执行已绑定真实 attempt，按实际 provider 走既有 Managed / BYOK 规则。
website 的 worker 只负责采集、编排与渲染；其文本、视觉和 TTS 请求必须回调 Next
内部 AI 网关，由当前 workspace 的既有工作板块模型选择解析 ExecutionPlan。worker
不得持有 provider Key，不再按 `purpleink-engine / website-video-v1` 复合服务额外
扣费；工作流父记录只聚合子 invocation。内部回调不得把原始凭据、prompt、渠道 URL
或供应商错误暴露到项目 UI。

## 6. Artifact 真值

- 所有 Artifact 必须来自实际最终字节，记录真实 SHA-256、大小、版本与 attempt。
- audio 至少保留源录音、ASR 文稿、时间对齐与最终视频 lineage。
- audio 的每个原声 WAV 切片同时登记两种不可变索引：`user-audio-cut` 保留诊断与
  来源谱系，公开 `narration-audio:{unitId}` 供既有 Director / render 消费；两条记录
  必须指向同一真实 storage key、SHA-256、大小与 attempt。音频 manifest 必须明确
  `source=user` 和原录音采样 offset，不得把用户原声伪装成 TTS。消费端除了解析
  ingest JSON，还必须逐 unit 核验 narration Artifact 的实际字节 hash 与大小。
  ASR 没有可用时间戳时只允许生成覆盖整段录音的单 unit，并把该 unit 投影为
  `confidence=0` / `lowConfidenceUnitIds`；不得伪造逐句高置信时间边界。
- audio 在外部 ASR 出网前先登记 attempt-scoped `user-audio-source`；Provider 失败
  仍保留这份已校验的源证据。同一 attempt 重放只复用完全相同的记录，新 attempt
  追加新版本，禁止原地改写既有 Artifact。
- website 至少保留安全的采集证据投影、编排结果与最终视频 lineage。
- script / audio 的正式下载必须同时满足：终片为 approved / released、所属 attempt
  成功、音效 Manifest 与当前音效设置一致，且终片 schemaVersion 对应的字幕交付形态
  与当前字幕设置一致。设置改变后旧成片仍可作为历史证据展示，但必须重新导出后才恢复
  正式下载，不能把旧无字幕成片描述成当前硬字幕交付（反之亦然）。
- approved / released Artifact 不可原地更新或删除；重试产生新版本并保留谱系。
  唯一例外是 §9 的整项目删除——那是把整个项目连同其全部产物一次性清除，
  不是对某个版本的就地改写。
- UI 只展示安全投影，不展示 raw worker 日志、credential、prompt 或隐藏推理。

## 7. 容灾与降级

每个新增执行器必须具备：队列 lease、有限重试、幂等键、可恢复检查点、用户可理解的
失败投影，以及明确的跳过/降级边界。website 需持久化 worker job 身份并处理 worker
重启后的查无任务；audio 需区分上传损坏、ASR 失败与时间对齐失败。
`audio-transcription` 与 `website-video` 各有独立单并发 lane，不进入承载既有旁白、
导出等作业的 fallback lane，长网站任务不得饿死主工作流。

三类项目共用的 UI 执行状态只能来自数据库派生的 `ProjectExecutionSnapshot`。
`projects.autopilot` 仍只表示 script Director 是否自动推进，不能通过响应字段把
audio / website 伪装成 autopilot。website 的 `succeeded` 必须同时满足最新 attempt
成功、六阶段成功、worker 校验通过，以及同一 attempt 的 approved MP4 Artifact 存在；
任一事实不一致时必须投影为 `blocked`，不得提供正式下载。

audio 使用独立的 `projects.director_continuation_enabled` 续接门闩。ASR 在入口节点
成功落库前，必须先在同一执行栅栏下开启该门闩；随后才把入口标为成功并恢复 Director
前沿。这样进程即使退出在“入口成功”和 `advancePipeline` 之间，后台仍能从 Postgres
识别并续跑。复用已成功 ASR 的显式启动只开启 audio 门闩，不得改写或返回 script
`autopilot`。

项目状态流的 SSE 只是低延迟失效提示，不是跨进程真值。画布在 active 状态下必须继续
从 Postgres 对账；SSE 连接成功但没有事件时，不得停止轮询或宣称状态实时。

降级不能伪造外部网站采集或媒体产物。模板回退、缓存命中和 Playwright 备用路径都
必须作为可追溯的安全状态展示。诊断与验收继续遵循
`docs/conventions/workflow-failure-patterns.md`。

## 8. 网站阶段右侧检查器

网站节点沿用唯一 `CanvasInspector`，不得新建第二套右侧面板。选中
`website-stage` 时，面板使用已登记的 `SegmentedControl` 呈现固定四页：
`Data / Source / Gates / Execution`。

- 运行事实只从 `node.data.websiteExecution` 白名单读取：`phase`、`state`、
  `enginePhase`、时长与耗时、`verification`、最终 Artifact 元数据、安全失败码和
  `updatedAt`。畸形或缺失字段显示“等待受控 worker 回传”，不得猜造。
- `Source / Gates / Execution` 可以说明版本内固定的执行合同，例如生产默认路径为
  Playwright Chromium、公开网络 DNS fail-closed、匿名采集、45 分钟引擎截止与
  50 分钟队列保护；这些必须标成“默认合同”或“策略”，不能冒充本次运行事实。
- 当前项目 SSE 只保证节点状态与终态刷新；同一 `running` 状态内的
  `websiteExecution` 是阶段检查点投影，不宣称逐秒实时。
- 禁止展示或序列化完整 URL 的 path/query/hash、header、cookie、DOM、credential、
  prompt、provider 原始错误、worker 原始日志、缓存目录或隐藏推理。缓存未投影
  hit/miss 时只显示隔离策略，不显示伪造命中结果。

## 9. 项目删除合同

用户在项目页右键菜单发起的「删除」是**不可恢复的整项目物理删除**，不是归档：
`projects` 行连同该项目的画布节点、边、pipeline run、task attempt、并发租约、
项目来源与全部 Artifact 记录一起从 Postgres 消失。删除范围严格锚定
`(workspaceId, projectId)`，不影响同工作区的其他项目。

入口与状态口径见 `routing.md` §4 的 `/api/projects/[id]` DELETE 行。实现是
`src/features/projects/project-deletion.ts` 的单个事务，顺序即正确性：

1. **在途守卫**：该项目存在 `queued` / `running` 的 `task_attempts`，或
   `waiting` / `active` 的 `workflow_concurrency_leases` 时，返回 409 且一行不删。
   worker 可能正握着这些行，先删会让它在写回时撞外键。
2. **声明清除意图**：事务内 `set_config('purpleink.project_purge', 'on', true)`。
   `artifacts_immutable_lifecycle_trigger` 只在这个标记下放行 approved / released
   产物的 DELETE，且**只豁免 DELETE、不豁免 UPDATE**（migration 0019）。因此
   「已审批产物永不被就地改写」这条不变量在删除路径上依然成立。
3. **断开外部产物引用**：把引用了本项目产物的 `ai_invocations.trace_artifact_id`
   置空。挂在本项目 run / attempt 上的 invocation 明细会由既有
   `ai_invocations_run_fk` / `ai_invocations_attempt_fk` 的 CASCADE 一并消失；
   工作区级的用量周期与计费账本不属于项目级联，金额真值不受影响。
4. **按谱系分层删除产物**：`artifacts.supersedes_artifact_id` 是 RESTRICT 自引用，
   不能延迟到语句末，一条 DELETE 清不掉父子行；每轮只删当前无人 supersedes 引用
   的产物，直到清空。不用「把 supersedes 置空再批量删」，那等于就地改写谱系。
   **终止条件按「本轮是否有进展」，禁止写死轮数上限。** 真实项目的版本链可以很长
   （已在开发库观测到一个项目有 520 个产物、`narration-audio` 版本链深 96 层，
   需要 96 轮才清空）；写死上限会把正常项目误判为数据异常，并在 UI 上表现为
   无法解释的「项目删除失败」。“仍有剩余但一行都删不掉”才是真环，那时才报错。
5. **删除 projects 行**：其余表由 CASCADE 收走（产物已先删，
   `artifacts.attempt_id → task_attempts` 的 RESTRICT 不再阻塞）。
6. **提交后清理字节**：按收集到的 `storage_key` 逐个调 `StorageAdapter.delete`。
   单个文件失败只跳过并计数，不回滚——数据库是真值，孤儿文件不该把已成功的
   删除翻回失败。

回归护栏在 `src/features/projects/project-deletion.pg.test.ts`：含 supersedes 谱系
可删、比任何固定轮数上限都深的 96 层链可删、存活 invocation 只被置空、存储字节被清、
在途 attempt 与未释放租约各自 409 且一行不删、同工作区其他项目完全不受影响、未知项目 404。

项目标题没有唯一约束，重名合法：`projects` 上只有 `(workspace_id, id)` 与
`(workspace_id, id, workflow_kind)` 两个唯一索引，重命名与删除均按 `id` 定位，
同名项目不会互相影响。

## 10. 项目执行停止合同

三类项目统一通过 `DELETE /api/projects/[id]/start` 停止，旧
`DELETE /api/director/pipeline` 只做代理兼容。停止目标是单个项目的执行，不终止
共享 Web、队列或渲染 worker：

1. 事务锁定项目，同时关闭 script autopilot 与 audio Director 续接门闩；只有当前代次
   仍有 queued 作业、尚未收到取消请求的 running 作业，或任一来源专属门闩仍开启时才
   递增 `execution_epoch`。重复查询停止状态不得再次递增代次。
2. 旧代次 queued attempt/run 立即进入 `cancelled`；running attempt 写
   `cancel_requested_at`，由持有者心跳触发 `AbortSignal` 后确认退出。
3. waiting 租约与 scheduled Provider ticket 立即取消。Provider 尚未出网的计费预留
   全额释放；已经出网但用量未知的调用继续使用保守结算，禁止猜测零用量。
4. Provider、Director、音频、渲染和网站链路在出网前、Artifact 登记前与节点成功写回
   前检查执行代次和取消信号。旧代次迟到结果不得注册产物或覆盖节点。
5. 仍有 running 作业时 API 返回 `stopping + remainingRunning`；全部确认退出才返回
   `stopped`。删除守卫在 `stopping` 期间继续返回 409，完成后 queued attempt 与
   waiting/active 租约必须为零，项目方可删除。

分镜并发租约的身份是 `(workspace_id, project_id, work_unit_key)`；同工作区不同项目
都叫 `S001` 时仍是两条独立租约。准入公平顺序以真实可执行 attempt 为唯一真值：
已持 active 租约的后续阶段优先，其次项目级任务，再次是到期 waiting 分镜；暂不可
准入的候选不得阻断扫描窗口内的后续可执行候选。500ms 只控制首批启动节奏，active 为
0 时必须立即放行首个分镜，不能循环重置倒计时。

## 11. 三来源状态机与提交点

三类来源共用 `start → attempt → execution_epoch → queue → artifact commit → advance`
控制链，但不合并其业务拓扑：

| 来源 | 固定拓扑 | 成功提交点 |
| --- | --- | --- |
| script | 导入 → Director → 动态镜头 fan-out → 汇聚 → 导出 | 当前 epoch 的最终 MP4 Artifact 已按真实字节登记且 schema 与导出设置一致 |
| audio | ASR → 原音频绑定 → Director → 镜头链 → 汇聚 → 导出 | ASR 与原音频 Artifact 均绑定，最终 MP4 满足同一交付门禁 |
| website | capture → script → narration → compose → render → export | 六阶段完成，最终 Artifact approved 且验证证据通过 |

- `start` 在事务内决定创建新 attempt 或复用当前 epoch 的 active attempt；不得持锁
  调用外部队列。入队失败进入可恢复前沿，不伪造 running。
- fan-out 的每个镜头节点有独立逻辑键，汇聚只消费当前 epoch 已提交的 Artifact；旧
  epoch 结果即使稍后成功返回，也不得写节点、登记 Artifact 或推进 DAG。
- “跳过”只适用于既定媒体/验收节点。跳过或降级必须产生 manifest 证据，UI 显示
  `cancelled/blocked/degraded` 语义，禁止冒充成功或 QA 通过。
- 恢复只自动领取 Provider 尚未开始的基础设施中断；Provider 已开始后的失败由安全
  失败投影明确结束，用户重试产生新 attempt。

## 12. 统一执行快照与恢复

`ProjectExecutionSnapshotV2` 是三来源控制面的唯一读模型。公共字段为
`schemaVersion/projectKind/state/attempt/currentWork/failure/recovery/delivery/detail`，
`detail` 按 `script | audio | website` 判别。一个发布周期内保留 v1 顶层别名供旧
消费者只读；新 UI 只读 v2。SSE 仅发送失效提示，刷新后数据库快照重新成为真值。

终态 attempt 必须同步收敛 invocation、Provider ticket 与并发租约。默认只读命令
`pnpm verify:workflow` 用于持续审计；`pnpm recover:workflow -- --apply` 只可用 CAS
修复仍满足 workspace、父 attempt、epoch 与当前状态条件的可变孤儿。历史时间逆序
显示为“历史时钟异常”，不得伪造持续时间或改写历史完成记录。
