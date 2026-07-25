# ISSUE-005 交接总结

### 背景与范围

`docs/issues/` 只覆盖**前端画布 Director**（`src/features/director/**` + `src/features/audio/**`），不碰 `server/**`。
ISSUE-005 属 **P1、第三批**，README §5 原文写「需要 001 + 002 先能跑通，才能验真实音频时长」。
实际执行时 001 已 done、002 仍 open，因此**代码修复全部完成，运行时观测分两部分交付**（见「未完成事项」）。

问题本质：INGEST 需要「每个 script unit 的音频时长」来分配帧数，但真实时长只有 TTS 合成后才知道。
迁移期用固定值把这个洞填上，形成「先编时长 → 按编的时长渲染 → 事后才合成真音频」的**时序倒置**。
`audio-demo.ts` 给每镜恒定 8000 ms / 30 fps / 240 帧，engine 写 `demo-tts`，audioFile 指向不存在的
`project://audio/demo.mp3`；这份编造数据经 `renderSpec` 直接决定真实 MP4 的真实长度。

**要修的是顺序，不是数值。**

---

### 深度分析结论

| 点 | 结论 |
| --- | --- |
| 性质 | 链路里唯一的**时序性架构错误**，其余 issue 都是接线或收敛 |
| 假数据影响面 | 不是显示问题：`stage-result.ts` FABRICATE 分支把 allocation 的 `durationInFrames` 写进节点 `renderSpec`，`render-shot-repository.ts` 用它做 Playwright 逐帧循环次数与 ffmpeg 帧数上限 |
| 第二处合成 | `stage-effects.ts` 的 `shot-sfx` 调 `generateVoiceover` 真实合成，但那时帧数已固化，合出来的音频无处可用——**同一分镜有两条语音来源的风险** |
| 回退分支 | `runtime-artifact-source.ts:64` 还有第二处：ingest artifact 缺 manifest 时**重新构造 demo 音频**。只删 `audio-demo.ts` 不够，这条回退必须一起拆 |
| schema 现状（关键发现） | `schemas/ingest.ts` **原本就有**真实口径枚举（`unit-boundary` / `unit-file` / `unit-files` / `vnext-audio-v1`），旧代码选的是同一 schema 里的**回退枚举** `duration-weight-fallback`。因此不需要新增 `measured` 枚举 |
| `prepareStageResult` 是同步纯函数 | 这是本 issue 最大的结构性改动点，issue §5 要求「先给出方案再动手」 |

---

### 两处方案抉择（issue 明确要求先定方案）

#### 抉择一：`prepareStageResult` 改异步（采用方案 B）

| 方案 | 结论 |
| --- | --- |
| A：TTS 放进 `runStageEffect`，allocation 事后回填 | **否决**。effect 在 `writeArtifact` 之后运行，artifact 会先带空/占位 allocation 落库再被回填——既破坏不可变性，也直接违反验收第 4 条「不得产生任何 artifact」 |
| B：`prepareStageResult` 改 async，TTS 在写 artifact 之前完成 | **采用**。artifact 只在旁白合成并实测成功后才存在，失败路径天然零产物 |

落地形态：`prepareStageResult(context, rawContent, dependencies?)` 返回 Promise，
`synthesizeNarration` 依赖注入，默认实现用 dynamic import 拉 server-only 模块，
因此 `stage-result.ts` 本身仍可在 node 环境单测。
`stage-runner` 的 `prepareResult` 类型放宽为 `T | Promise<T>`，调用点 `await`。

#### 抉择二：不新增 `allocationMethod: 'measured'`

issue §4.1 第 5 条允许「若 schema 未包含该枚举值，同步扩展」。核实后发现无需扩展：

| 字段 | 旧值（假） | 新值（真） | 新增枚举 |
| --- | --- | --- | --- |
| `shotAllocation.allocationMethod` | `duration-weight-fallback` | `unit-boundary` | 否 |
| `audioUnit.alignment.mode` | 未填 | `unit-file`（coverage=1） | 否 |
| `alignmentReport.policy` | 未填 | `unit-files` | 否 |
| `audioManifest.contractVersion` | 未填 | `vnext-audio-v1` | 否 |

每个分镜正好覆盖一个完整音频文件，`unit-boundary` / `unit-file` 就是如实描述；再加 `measured` 会与既有语义重叠，制造第二套口径。
额外收益：启用 `vnext-audio-v1` 后 schema 的 `superRefine` **强制**
`sampleRateHz` / `sampleCount` / `sha256` / `alignment` / `alignmentReport` 必填 ——
「必须有实测数据」变成结构约束，而不是靠代码自觉。

---

### 已落地改动（commit `71f1de4` + `171f692`）

**新增**

- `src/features/audio/mp3-frame-header.ts`（127 行）—— 纯函数解析 MPEG 帧头取**原生采样率**；带「下一帧必须仍同步」校验，避免把数据里的 `0xFF` 误认成帧头。刻意**不**从帧计数推算时长（会把编码器 delay/padding 算进去）
- `src/features/audio/measure.ts`（92 行）—— `measureMp3` 用 `ffmpeg-static` 把真实字节解码成 16-bit 单声道 PCM 并统计采样数，`durationMs = sampleCount / sampleRateHz × 1000`。**不读 TTS 自报 `duration`，不按字数估算**
- `src/features/audio/narration.ts`（229 行）—— 批量合成（默认并发 4，与 ISSUE-004 通道语义一致，未因 TTS 慢写死成 1）；按 `sha256(engine|voice|text)` 内容寻址复用字节；运行中模型路由漂移即失败
- `src/features/audio/narration-repository.ts`（93 行）—— 落盘后**复核实际字节 SHA-256** 再原子登记 artifact；每 unit 独立 kind `narration-audio:U00N`
- `src/features/director/audio-timing.ts`（143 行）—— 取代 `audio-demo.ts`，纯函数由实测结果构造 manifest / allocation，`durationInFrames = ceil(durationMs × fps / 1000)`（**向上取整**，宁可多一帧也不截断语音）；`MASTER_FPS = 30` 落在此处作为母版时间轴常量
- `src/features/director/stage-artifact-gate.ts`（156 行）—— 见下方「规模门禁」

**删除（不留 fallback）**

- `src/features/director/audio-demo.ts`
- `src/features/audio/voiceover.ts` + `voiceover.test.ts` —— 第二处合成路径消失，全仓库 `generateVoiceover` 零命中

**改写**

- `stage-result.ts` —— 改异步，INGEST 分支消费实测结果
- `runtime-artifact-source.ts` —— 删掉「缺 manifest 就重造 demo」的回退分支，缺失即失败
- `audio/runtime-repository.ts` —— `loadVoiceover(projectId, shotId)` → `loadNarration(projectId, unitId)`，读 INGEST 产物并核验字节 hash
- `stage-effects.ts` —— `shot-sfx` 从生产方改为**消费方**（只 `loadNarration` 核验）；`shot-subtitle` 复用同一份音频做 ASR
- `artifacts/service.ts` —— content-type 映射跟随新 kind
- `audio/types.ts`、`audio/index.ts` —— 移除 `Voiceover*` 类型与导出

**规模门禁**

`stage-runner.ts` 因 `prepareResult` 签名从 1 行变 4 行而达到 **352 行 > 350 硬上限**。
按 AGENTS.md §5「必须在当前 Task 内按真实职责拆分」，拆出 `stage-artifact-gate.ts`
承担「产物生成 + 门禁重试」（`generateValidatedArtifact` / `STAGE_OUTPUT` / `MAX_GATE_RETRIES` /
`toolsForStage` / `outputArtifact` / 重试提示词）。
runner 保留节点状态机、会话生命周期与下游推进。**不是 re-export 壳**，未把新文件写进 baseline。
`stage-runner.ts` 现 232 行。

**未动（禁区全程有效）**

`server/**`、`server/src/tts/**`、`pi-session.ts`、`session-store.ts`、`pi-output.ts`、
`prompts/**`（`ingest.ts` 原本就写着「音频 manifest/allocation 必须由应用根据实测媒体生成」）、
`tools/**`、`src/features/render/**`（属 ISSUE-002 在途范围）。

---

### 验证证据

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 本 issue 范围（`features/{audio,director,artifacts}`）零错误 |
| `pnpm vitest run src/features/{audio,director,artifacts}` | 24 files / 122 passed |
| `pnpm test:pg src/features/audio/runtime-repository.pg.test.ts` | 3/3 passed |
| `pnpm verify:v3` | **exit 0**；violations 空、replacementCharacters 空、oversizedFiles 仅 3 个已登记营销文件 |
| grep `demo-tts` / `project://audio/demo.mp3` / `buildDemoAudio` | 源码零命中（仅 issue 文档提及） |
| grep `generateVoiceover` | 全仓库零命中 |

**真实运行证据**（Gemini 真实切分 + StepFun `stepaudio-2.5-tts` 真实合成，无 fixture、无 mock）。
稿件刻意含一段 9 字与一段 79 字：

| unit | 文本长度 | manifest `durationMs`（实测） | `ffprobe` | 差值 | ≤1 帧 | shot | `durationInFrames` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U001 | 9 | 2281.958 ms | 2304 ms | +22.04 ms | 是 | S001 | **69** |
| U002 | 79 | 14473.958 ms | 14496 ms | +22.04 ms | 是 | S002 | **435** |

- 时长相差 6.3 倍，帧数 69 ≠ 435；修复前恒为 240 帧
- +22.04 ms 恒定差值 = 529 samples @24 kHz，是 MP3 解码器延迟：`ffprobe` 报帧计数时长，本仓库实测解码后可听采样数（gapless 裁剪后），关系稳定且在 ±1 帧公差内
- `director-ingest` 与两个 `narration-audio:*` 的 DB `content_hash` 与磁盘实际字节 SHA-256 **三处全部一致**
- manifest：`engine=stepaudio-2.5-tts`、`voice=cixingnansheng`、`contractVersion=vnext-audio-v1`、`totalMs=16755.92`、`alignmentReport.policy=unit-files`、`fps=30`、`totalFrames=504`

**缓存复用（额外验收项）**：复位节点状态后按真实 API 重跑，两次 `storage_key` 与 `content_hash` **完全一致**。
storage key 由输入内容寻址，TTS 输出非确定性 —— 若真的重新合成必然得到不同字节与不同 hash，一致即证明命中已落盘字节、未重复计费。

**负向验证（验收第 4 条）**：删除 `provider_credentials` 的 stepfun 行后跑新项目 INGEST：
job `failed`、节点 `failed`、`directorError = {"stage":"INGEST","message":"尚未配置 StepFun API Key"}`、
`director-ingest` 与 `narration-audio:*` **均为零**，无 8 秒占位。
验证后立即 `pnpm tsx scripts/setup/bootstrap-credentials.ts` 从 `.env.local` 恢复，已确认 stepfun `verified=true`。

证据文件：`docs/issues/evidence/issue-005/{README.md, ingest-measured-durations.json, reuse-and-negative.json, ffprobe-raw.md}`

---

### 未完成事项（如实标注，不声称已验证）

验收 §7 第 3 条还含两项**运行时观测**：

1. **「渲出的两个单镜 MP4 时长不同」** —— 依赖 **ISSUE-002**：`fabricateShot()` 仍零调用方，
   `director-fabricate` 产物不会生成，render 入队会因缺产物被拒。ISSUE-002 当时为 `open`
   且**正由他人并行修改 `src/features/render/**`**，本 issue 不越界改那些文件。
   已确认的等价证据：`renderSpec.durationInFrames` 由 allocation 直接决定，而 allocation 的
   69 / 435 已实测取证；`render-shot-repository.ts` 用同一 `renderSpec` 作为逐帧循环次数与 ffmpeg 帧数上限。
2. **「`shot-sfx` 没有产生第二份语音 artifact」** —— 代码层面已无第二条合成路径，
   `stage-effects.test.ts` 锁定该行为，但**无运行时观测**（同样等 ISSUE-002 打通）。

---

### 遗留观察（不属本 issue，已在 issue §9.5 登记）

单镜 MP4 目前**不含音轨**：`encode.ts` 用 `-an`，`concat.ts` 只接受分镜 mp4 + 配乐，
旁白音频尚未混入成片。本 issue 只负责「时序与时长真值」，混音接线属 ASSEMBLE / 导出范围。

---

### 并发会话实录（给下一位执行者的硬提醒）

本次执行期间该 worktree 有**至少 3 条并行线**同时动手，产生两次真实碰撞：

1. **`src/lib/db/schema/canvas.ts` 被摘掉 `positionX/positionY` 但没有配套 migration**（ISSUE-008 在途）。
   后果：committed migration 里 `position_x` 仍是 `NOT NULL` 无默认，drizzle 插入时发 `default`，
   于是**所有**向 `canvas_nodes` 插入的 pg 测试与真实建项目路径全部
   `null value in column "position_x" violates not-null constraint`。
   我**没有**替他们写 migration，而是把自己的 fixture 改成不播种画布节点
   （`loadNarration` 只按 workspace/project/kind 查 `artifacts`，本来就不 join `canvas_nodes`，
   依赖面本该与实现一致）—— commit `f2601bd`。这样两种 schema 状态下都能过。
2. **dev server 端口 3000 被反复抢占/重启**，我起的实例连续两次退到 3001 并自我终止。
   取证脚本最终复用了别人已在跑的 3000 实例。

**当前遗留红项（不是我的）**：`pnpm test` = 1 failed / 101 passed，5 个用例全在
`src/features/render/queue-handler.test.ts` —— ISSUE-002 已改
`HandlerRepository`（新增 `hasFabricateArtifact`）与 `RenderAdmissionContext`，测试尚未跟上。

**建议**：后续并行 issue 各自开 `git worktree`，至少 commit 前 `git status --porcelain` 确认只含自己的文件；
schema 改动必须与 migration 同批提交，否则会横向阻塞所有其他线的 pg 验证。

---

### 给下一位执行者

1. **下一块骨牌仍是 ISSUE-002**（`fabricate-render-seam`），它现在同时卡着两条线：
   自己的第一个单镜 MP4，以及 ISSUE-005 剩下的两项运行时观测。
   打通后请回到 `docs/issues/evidence/issue-005/README.md` §6 补齐，并把该文件 §6 改成已完成。
2. **音频时长真值链已定型，不要另开第二条**：
   - 时长只能来自 `measureMp3()`（解码采样数）。**禁止**改回 TTS 自报 `duration` 或
     `text.length * k` 估算 —— 这是 issue §6 明文禁区。
   - `audio-demo.ts` 已删且不得以「可选 fallback」名义复活；
     `runtime-artifact-source.loadIngestArtifact` 缺 manifest 必须失败，不得再加回退构造。
3. **合成只有一处**：INGEST。`shot-sfx` / `shot-subtitle` 都是消费方，
   经 `AudioRuntimeRepository.loadNarration(projectId, unitId)` 取字节并核验 hash。
   若未来要做音效混音，在 `shot-sfx` 里**混**已有旁白，不要再合成一份。
4. **artifact kind 约定**：每个 script unit 一个独立 kind `narration-audio:U00N`。
   共用一个 kind 会让 N 段旁白在 `(aggregate, kind, version)` 版本链上互相 supersede，
   被误记为同一产物的多个版本。新增按单元扇出的产物时沿用这个模式。
5. **缓存语义**：storage key = `narration/{projectId}/{sha256(engine|voice|text)}.mp3`，
   项目内寻址（覆盖「重试不重复计费」这个真实场景）。若要跨项目复用需重新设计
   artifact lineage，不要顺手改 key 前缀。
6. **`stage-artifact-gate.ts` 是新的职责边界**：门禁重试与产物 key/validation 映射都在那里，
   不要再把这些逻辑搬回 `stage-runner.ts`（会立刻重新撞 350 行硬上限）。
7. **凭据取证路径可复用**：`pnpm tsx scripts/setup/bootstrap-credentials.ts` 从 `.env.local`
   写入 DB 加密存储；负向验证若要清凭据，删 `provider_credentials` 对应行后**必须立即用同一脚本恢复并复查
   `verified=true`**。
8. **若需复验**：
   `git show 71f1de4`（测量层）、`git show 171f692`（实现）、`git show 484355e`（证据）、`git show f2601bd`（fixture）；
   `pnpm vitest run src/features/{audio,director,artifacts}` 应 24 files / 122 passed；
   `pnpm verify:v3` 应 exit 0。

---

## 附：全项目 Issue 状态快照（截至 commit `f2601bd`）

| ID | 优先级 | 状态 | 关键提交 / 阻塞点 |
| --- | --- | --- | --- |
| ISSUE-001 pi-agent 运行时 | P0 | `done` | `847722d` + `4b621fe` |
| **ISSUE-002 FABRICATE→render 接缝** | **P0** | **`open`（在途）** | 工作区有未提交改动；`queue-handler.test.ts` 5 例红 |
| ISSUE-003 Next AI 凭据 | P0 | `done` | 7 commits |
| ISSUE-004 队列分轨 | P1 | `done` | `97b741e`（提交信息文不对题，见 Batch-001） |
| **ISSUE-005 音频时序真值** | **P1** | **`done`** | `71f1de4` + `171f692` + `484355e` + `f2601bd` |
| ISSUE-006 休眠 pipeline 层 | P2 | `open` | 未开工；持有 `vitest.config.ts` 12–14 行 exclude 所有权 |
| ISSUE-007 双画布 | P2 | `done` | `cfcc52a` |
| ISSUE-008 画布布局真值 | P2 | `open`（在途） | 有 `evidence/issue-008/`；schema 改动曾横向阻塞 |
| ISSUE-009 routing 收敛 | P2 | `done` | `94af7d3` |
| ISSUE-010 超行文件 | P2 | `done` | 5 commits |
| ISSUE-011 设置页占位 | P2 | `open`（在途） | `8baee2e` + `b9696a0` 已落地队列配额层 |
| ISSUE-012 画布实时更新 | P2 | `open`（在途） | 有 `evidence/issue-012/` |
| ISSUE-013 AI 适配器边界 | P2 | `in-progress` | `2305884` + `d53270a` + `3afbc57`；openai 债务 3 → 1 |
| ISSUE-014 端到端验证 | 贯穿 | `open` | 等 ISSUE-002 后可跑第一个完整「文本 → MP4」 |

**关键路径已收敛到一处**：ISSUE-002。001/003/004/005 都已落地，
「文本 → 切分 → 实测旁白 → 真实帧数」这一段已经真实可跑；
缺的只剩 `fabricateShot` → render 队列这一个接缝，接上即出第一个单镜 MP4。

---

## 补充交接：ISSUE-011 设置页占位项与并发配额（截至 commit `d63d89d`）

### 状态

**ISSUE-011 已完成。** 原先 `/products/settings` 的两项问题已经分别处置：

| 原项 | 最终处置 | 结果 |
| --- | --- | --- |
| `崩溃续渲` / `尚未实现（Demo 占位）` | 删除 | 当前没有 checkpoint / 断点续渲基础设施；保留空控件只会误导。渲染缓存仍按 render key 复用已完成镜头。 |
| `渲染并发数（CPU 核数，暂不可配置）` | 接线为真实配置 | 拆为 Director 与 render 两个独立配额，不再把 LLM I/O 与 Chromium/ffmpeg 混成一个数字。 |

### 已锁定的产品与技术决策

| 决策 | 采用方案 | 理由 |
| --- | --- | --- |
| 存储位置 | 新表 `workspace_settings` | 并发是账号/进程级偏好，不可放项目级 `projects.export_settings`，也不应污染模型路由表。 |
| 数据形状 | key = `queue.lane_quotas`；value = `{ schemaVersion: 1, directorStage, renderShot }` | 一个明确 key，一套结构化 JSON 真值。 |
| 真值优先级 | **DB > env > 代码默认** | 与 AI 配置口径一致；DB 配置覆盖 `CVC_QUEUE_*_CONCURRENCY`，未配置时才回落 env / `InProcessQueue` 默认值。 |
| 生效方式 | 保存后重启 dev 进程 | `InProcessQueue.lanes` 只在 `initQueue()` / `queue.start()` 时读取。没有伪造“已热生效”；UI 和 API 均如实提示。 |
| 上限 | `directorStage: 1..32`；`renderShot: 1..128` 且 route 二次校验 `<= os.cpus().length` | Director 为网络 I/O 可高并发；渲染受 Chromium + ffmpeg 的 CPU/内存约束。 |
| UI 数据加载 | 单 controller / 单次 `/api/settings` | 删除旧 `SettingsForm` 私有 `SettingsResponse` 与第二个 fetch，模型配置、路由、配额共用一份 API 投影。 |

### 已落地提交

| Commit | 内容 |
| --- | --- |
| `8baee2e` | migration `0002_workspace_settings`、Drizzle schema 与 snapshot；连续两次 `pnpm db:migrate` 通过。 |
| `b9696a0` | `src/lib/queue/runtime-config.ts`：`describeLaneQuotas`、`saveLaneQuotas`、`loadLaneQuotasForStart`；`initQueue()` 接入 DB > env > 默认。 |
| `0c89855` | `/api/settings` GET 返回含 source 的 `laneQuotas`；POST 校验并保存，非法值 400 且任何 secret / route / 配额均不落写。 |
| `3a502a1` | 新建 `runtime-concurrency-panel.tsx`；设置页显示两个 lane、来源、账号级范围、重启提示；删除崩溃续渲和只读并发数。 |
| `9734dcd` | routing.md 登记 `/api/settings` 字段范围；设置布局契约；ISSUE-011 状态改 done。 |
| `67f5fcb` | schema metadata 契约从 12 表 / 23 外键更新为 13 表 / 24 外键；`workspace_settings` 主键为 `(workspace_id, key)`。 |
| `d63d89d` | ISSUE-011 验证与并行失败边界入档。 |

### 关键文件与职责

| 文件 | 职责 |
| --- | --- |
| `src/lib/db/schema/core.ts` | `workspaceSettings` 表定义。 |
| `src/lib/db/migrations/pg/0002_workspace_settings.sql` | 已提交的生产 migration。不要删除或手改已应用 migration。 |
| `src/lib/queue/runtime-config.ts` | 配额的唯一持久化与读取逻辑；所有新增读取方必须复用，禁止再直接读 `process.env` 拼第二套优先级。 |
| `src/lib/queue/init.ts` | 保留 `resolveLaneQuotas()` 仅用于严格 env 解析；实际启动用 `loadLaneQuotasForStart()`。 |
| `src/features/ai/schemas.ts` | `laneQuotasSchema`；静态上限与整数校验。 |
| `src/app/api/settings/route.ts` | 动态 CPU 上限校验、400/422 状态码边界、`requiresRestart` 响应字段。 |
| `src/app/products/(app)/settings/runtime-concurrency-panel.tsx` | 两 lane UI；不要往接近 350 行的 `model-service-panels.tsx` 追加该类功能。 |
| `src/app/products/(app)/settings/model-service-settings.tsx` | 共享 controller 与唯一 fetch；配额 draft 只在 DB source 时回填，env/default 是只读有效值。 |
| `src/lib/db/schema-metadata.pg.test.ts` | 数据库 inventory 的精确契约；之后新增表、外键、复合主键时必须同步更新。 |

### 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `pnpm db:migrate` 连续执行两次 | 通过 |
| `pnpm test:pg -- runtime-config` | 7/7 pass：默认、env、DB > env、upsert、非法值、启动期合并 |
| `pnpm test -- src/app/api/settings/route.test.ts` | 17/17 pass：合法、0、负数、非整数、静态超限、CPU 超限、凭据失败不落写、联合保存 |
| `pnpm test -- tests/products-settings-layout.test.ts` | 4/4 pass：占位词零命中、双 lane、账号级、重启提示 |
| `pnpm test:pg -- schema-metadata` | 6/6 pass：13 表、24 外键、复合主键、UUID/timestamptz inventory |
| `pnpm build` | 通过 |
| `pnpm typecheck` | 无错误输出 |
| `pnpm verify:v3` | `violations: []` |

### 已知边界与下一位执行者注意事项

1. **不要把保存行为改成假热更新。** 如要支持即时生效，必须先为 `InProcessQueue` 设计并实现受测的 lane 更新 API，并明确处理运行中 job；否则继续维持“重启后生效”。
2. **不要把两个 lane 合回一个“渲染并发数”。** 这会直接复发 ISSUE-004 的队头阻塞和资源互相抢占问题。
3. **不要绕开 `runtime-config.ts` 直接使用 env。** 那会造成 DB/UI 与实际队列的两个真值。
4. **`workspace_settings` 是通用 workspace 偏好表，不是任意 JSON 垃圾桶。** 新 key 要用全小写、点号/下划线命名；value 必须带 `schemaVersion`，并由所属 domain 建立 schema 和读取函数。
5. ISSUE-011 尚未做“>=6 unit 真项目的 SQL 并发观测”与真实 Chromium 截图。这两项依赖 ISSUE-002 打通 `fabricateShot -> render`，应在 ISSUE-014 端到端批次补证据，不得把 mock 结果伪装成真实视频链路。
6. 最后一次全量检查仍有其他并行领域失败，均不属于 ISSUE-011：
   - `pnpm test:pg`：`src/features/director/runtime-repository.pg.test.ts` 的 score input fixture。
   - `pnpm test`：`src/lib/stream/status-bus.test.ts` 的订阅者错误隔离用例。
   不要为使 ISSUE-011 “全绿”而修改或跳过这些测试；由对应 Director / stream owner 处理。
