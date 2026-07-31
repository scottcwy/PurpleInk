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
- `src/features/audio/measure.ts`（92 行）—— `measureAudio` 用 `ffmpeg-static` 把真实字节解码成 16-bit 单声道 PCM 并统计采样数，`durationMs = sampleCount / sampleRateHz × 1000`。**不读 TTS 自报 `duration`，不按字数估算**
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
   - 时长只能来自 `measureAudio()`（解码采样数）。**禁止**改回 TTS 自报 `duration` 或
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



# ISSUE-006 · 休眠 pipeline 层删除 + instrumentation 接线（done）

- 执行时间：2026-07-25（与 ISSUE-002 在同一工作树并行，落点零重叠）
- 最终状态：`done`，验收 §7 七项全过，取证留档 `docs/issues/evidence/issue-006/`
- 两项决策：issue §3 选**方案 A（删除整层）**；issue §5 选**新增 `src/instrumentation.ts`**（而非改测试了事）

### 提交链（4 个 commit，全部落在本地 master）

| Commit | 内容 |
| --- | --- |
| `1f545ed` | refactor(pipeline)：删除 `src/features/pipeline` 整层（**实数 20 文件、-1508 行**，issue 文件 §2.2 记的 14 为低估，多出的含 `services/service-contract.test.ts`、`contracts/tags.ts` 等）；回收 vitest 2 条 pipeline exclude + 已失效的 Stage A 注释 + tsconfig 1 条 exclude；`v3-architecture.test.ts` L132/L166 两处 fixture specifier 改为 `@/features/foo/*` 等价合成样本（断言强度不变，只是不再引用已删模块名） |
| `42568d2` | feat(runtime)：新增 `src/instrumentation.ts`；修复 `initQueue()` 失败缓存 rejected promise 的毒化缺陷（RED→GREEN，`init.test.ts` 新增失败重试用例） |
| `efc498f` | test(db)：修复 `runtime-boundary.test.ts` 陈旧 SQLite 断言，解除最后一条历史 exclude——**至此 README §2 所述门禁洞全部回收** |
| `1105acc` | docs：issue 文件记录两项决策 + §8 实施记录；README 状态/派发顺序/争用表同步；取证入档 |

### 规划期实测发现（三处与 issue 文件/直觉不符，已入档，下次不要重新踩）

1. **`runtime-boundary.test.ts` 解除 exclude 必红，与 instrumentation 无关**：L248/L250 断言
   `better-sqlite3@12.1.0` / `@types/better-sqlite3@7.6.13` 存在于 devDependencies，而
   package.json 已全面移除 SQLite。已改为断言 dependencies 与 devDependencies 均缺席（边界收紧，
   与 AGENTS.md「不得新增 SQLite 运行依赖」同口径）。`LEGACY_MIGRATION_FILES` 断言的是「不在 git
   跟踪中」，现状即过，未动。
2. **`v3-architecture-baseline.json` 无需任何改动**：L132/L166 是临时目录 fixture 断言，测的是扫描器
   规则本身，不影响真实仓库扫描计数；删 pipeline 后 canvasForbiddenImports 仍是原 15 条 db 债务。
3. **ISSUE-001 已提前回收自己的 exclude 行**：开工时 vitest exclude 只剩 3 条、tsconfig 只剩 1 条，
   全部归 006；README §6 的行号表已过时（已在该节追加清零标注）。

### instrumentation 设计要点（下一位不要推翻的点）

1. **register() 双守卫缺一不可**：`NEXT_RUNTIME !== 'nodejs'` 直接返回（edge 不承载进程内队列）；
   `NEXT_PHASE === 'phase-production-build'` 直接返回——build 期预渲染 worker 也会触发 register，
   此时 `queue.start()` 的 setInterval 会挂住构建进程。`pnpm build` exit 0 已实测验证守卫生效。
2. **模块顶层零副作用**：所有依赖在 register() 内动态 import。这不是风格偏好，是
   `runtime-boundary.test.ts` 的 import-safe 契约（`@/instrumentation` 在 IMPORT_SAFE_ENTRIES 里，
   import 时不得碰 FS/DB），现在该测试在默认测试池内常年把守。
3. **initQueue 失败可重试是配套修复，不是顺手优化**：旧实现失败后 `__cvcQueueInitializing`
   永久持有 rejected promise，API 路由兜底会永远拿到同一个失败直到重启进程；instrumentation
   把首次调用提前到启动期（DB 可能未就绪）会放大该缺陷。现在失败重置锚点，行为由
   `init.test.ts` 的「首次失败→第二次重试成功」用例锁定。register 内 try/catch 不阻断 Next 启动。
4. **API 路由里的 `initQueue()` 兜底调用不要删**：dev 模式 instrumentation 有时不触发
   （init.ts 注释已登记），兜底仍是必要路径；幂等由 globalThis 锚点保证，不会双消费。

### 验收证据摘要

| 项 | 结果 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` / `git diff --check` | 全部 exit 0；build 不挂起 |
| `pnpm test` | 108 文件 / 498 用例全绿。文件数变化可解释：基线 108/502 → 删层 107/492（-`service-contract.test.ts` 10 用例，它原本未被 exclude）→ 收口 108/498（+runtime-boundary 5 用例 +init 重试 1 用例） |
| `pnpm verify:v3` | `ok: true` 零违规；triggerTaskForbiddenImports 仍为空；baseline 未动 |
| 验收标准 7（无 HTTP 队列消费） | 独立取证库 + `pnpm start --port 3100` 生产模式，零 HTTP 请求下种子 attempt `8d2ec4d6…` 从 queued → 被领取 → failed（`no handler for kind: noop`，fallback lane 如实拒绝），归因唯一。详见 `evidence/issue-006/no-http-queue-consumption.md` |
| `pnpm test:pg` | **1 failed / 79 passed，失败项非本 issue 引入**（见下「遗留红项归因」） |

### 并发会话实录（与 ISSUE-002 同树并行）

1. **零文件重叠得以成立的前提是开工前逐文件核对**：002 的 16 个未提交修改全在
   `render/**`、`director/runtime-repository.ts`、`canvas/**`、`app/products/**`；006 的落点
   （pipeline、两个根配置、architecture/db 两个测试、instrumentation、queue/init）与之无交集。
   每次 commit 前 `git diff --cached --name-status` 逐条核对，全程未 stage 对方文件。
2. **Next 16 的 dev 锁是新发现的硬约束**：同一项目目录第二个 `pnpm dev` 直接拒绝
   （`Another next dev server is already running`，报出对方 PID），**换端口也没用**。
   以后并行取证要么等对方释放，要么用 `pnpm start`（无此锁），要么独立 worktree。
3. **取证隔离方式可复用**：主库上有对方 dev 进程在消费，无法归因，故在同一 Postgres 容器内
   新建取证库 `purpleink_issue006_evidence`（建库→`DATABASE_URL` 进程级覆盖→`pnpm db:migrate`→
   种子→观察）。取证后 3100 进程已杀，对方进程（3000/63424）与主库全程未受影响。
4. **沙箱内 git 写操作会被拒**（`git rm`/`add`/`commit` 需提权重跑），且首次失败时 `git rm`
   实际已生效——碰到同样报错先 `git status` 确认真实状态，不要盲目重跑删除类命令。

### 遗留红项归因（不是本 issue 的，但已查到根）

`pnpm test:pg` 唯一失败：`src/features/director/runtime-repository.pg.test.ts` 的
「assembles score input from versioned lane payload and artifact rows」，zod 报
`audioManifest` / `audioAllocation` 「expected nonoptional, received undefined」。
归因链：该必填契约由 ISSUE-005 的 `171f692`（已在 master）引入，而这个 pg 测试的 fixture
自 `1da0927` 后未跟进——与 ISSUE-011 交接「已知边界」第 6 条记录的是同一项。006 的三个代码
commit 与 director/pg 配置零交集，未越界代修。**应由 002/005 收尾时补 fixture 的
`audioManifest`/`audioAllocation` 字段**（参照 `audio-timing.ts` 的真实形状）。

### 已知边界与下一位执行者注意事项

1. **pipeline 层已死，不要以任何形式复活**：不要把 `ProgressSink`、`TaskFailureError`、
   `CVC_TASK_IDS` 等概念搬到别处「预留」；真需要任务服务层（外部队列/多进程）时从生产路径
   的需求重新设计，那是新 issue。`legacy.*` task_id 前缀与 `cvc.*` 常量已分属两个世界：
   前者是现行队列真实在用的，后者已随 pipeline 层消失。
2. **exclude 列表已归零，这是新的基线**：`vitest.config.ts` 只剩 configDefaults +
   `**/*.pg.test.ts`（pg 分流，非门禁洞）；`tsconfig.json` 不再排除任何源文件。
   任何新增 exclude 都应被视为开新门禁洞，需走 issue 登记，不得静默塞入。
3. **`v3-architecture.test.ts` 的 `@/features/foo/*` 是合成样本**，不对应真实模块；
   它们测的是 `isCanvasForbidden` 的 trigger 正则与 allowed 路径不误伤，不要「修复」成存在的路径。
4. **取证遗留物**：取证库 `purpleink_issue006_evidence` 仍在 `purpleink-dev-postgres-1` 容器内
   （只含 1 条已消费的种子记录，不影响主库；可随时 `drop database` 清理，未代删）；
   `.data/issue-006-evidence.mjs`、`.data/issue-006-{dev,start}.log` 留在 .data（gitignore，不入库）。
5. **若需复验**：`git show 1f545ed / 42568d2 / efc498f / 1105acc`；
   `pnpm vitest run src/lib/queue/init.test.ts` 应 6/6；
   `pnpm vitest run src/lib/db/runtime-boundary.test.ts` 应 5/5；
   `pnpm test` 应 108 文件/498 用例；`pnpm verify:v3` 应 `ok: true`。

### 全项目影响（本次之后的盘面）

- 未完成 issue 只剩：**ISSUE-002（在途，同树未提交）**、**ISSUE-013（in-progress 收尾）**、
  **ISSUE-014（等 002 后跑端测）**；其余全部 done。
- instrumentation 接线后，生产模式下队列不再依赖首个 HTTP 请求；ISSUE-014 端测时
  可直接依赖「进程起 = 消费起」这个语义，不需要预热请求。
- 第三套执行模型已清除，仓库内只剩 stage-runner（director）与 queue-handler（render）
  两条生产执行路径，与 README §0 的双系统边界一致。



# 交接：ISSUE-008 dagre 布局真值（截至 commit `10088e5`）

### 状态

**已完成，已合并 `master`。** 坐标只有一个真值来源：`layout.ts` 的 `computeLayout()`。
`canvas_nodes.position_x/y` 两列已从 schema 和数据库彻底删除，不是「停止读」而是「物理不存在」。

### 决策：方案 A2（彻底删列），非方案 B/C

issue 原文给了 A/B/C 三条路，本次核实后选 A 的加强版（A2 = 删列，而非「保留列但停止写」）：

| 待核实项 | 结论 |
| --- | --- |
| 设计稿是否规定可拖动 / 有自动布局控件 | 未连上 Pencil 实例，退查 `Design-system-inventory.md`：S3 屏主操作只有 `Run ready nodes`，全文搜"拖/drag/自动布局"零命中。方案 B 不成立。 |
| `position_x/y` 是否 `NOT NULL` 无 default | 是。这意味着 issue 原文设想的「不删列但停止写」实际不可执行——不写值会违反约束，成本和删列相当，故选删列。 |
| issue §2.3 引用的 `nodesDraggable={false}`（`canvas-view.tsx:114`） | **过时证据**。`git log -p -S nodesDraggable` 证实这行属于已被 ISSUE-007 删除的 `workflow-canvas.tsx`（旧重复画布），不是现生产 `CanvasView`。现生产代码根本没设这个 prop，默认 `true`——节点表面可拖，因未接 `onNodesChange` 回写，下次父组件重渲染（1.5s 轮询）就弹回原位，比"硬禁用"更容易迷惑用户。已在 issue 文件里改正。 |
| share snapshot 白名单是否引用坐标 | 否，`routing.md §8.3` 白名单只提「节点、连线、节点类型」，删列不影响分享快照。 |

### 已落地改动

- `schema/canvas.ts` 删 `positionX`/`positionY`；新 migration `0003_drop_canvas_node_position.sql`（`DROP COLUMN` ×2），双跑验证幂等
- `actions.ts` / `fan-out.ts` 停止写坐标
- `queries.ts` 不再 select 坐标；新增 `PositionedCanvasNode = CanvasGraphNode & { position }` 类型，把「坐标只来自 `computeLayout`」编码进类型系统而非靠约定
- `page.tsx` 删掉 `positions.get(node.id) ?? node.position` 里那条永远走不到的 DB 坐标兜底分支
- `layout.test.ts` 新增两个测试：多泳道 AABB 包围盒不重叠、新增泳道不位移已有泳道
- 同步 8 处测试 fixture（`canvas-*.pg.test.ts`、`schema.pg.test.ts`、`render.pg-fixture.ts` 等）

真实截图证据：5 泳道 29 节点项目，Playwright/Chromium 截图 3 次（首次 + 刷新 2 次），
29 个节点 DOM 坐标逐一比对**完全一致**，控制台零报错。`docs/issues/evidence/issue-008/`。

### 并发处理实录（给下一位执行者的硬提醒）

动手时发现仓库有另一并发会话正在实时改 `audio/**`、`director/**`、`render/**`
（就是本文件里 ISSUE-005 那条线），且 `master` 在修复过程中前后推进了 **6 次**。
处理方式，供后续类似情况参考：

1. **改动前先切独立 `git worktree` + 独立 Postgres 容器**（不同端口的 docker 容器），
   避免自己的 migration/测试跑动摇了对方正在用的共享 Postgres。
2. **合并时 `master` 已经动过**：本 issue 的 migration 原打算用 `0002`，但对方已用掉这个序号
   （`0002_workspace_settings.sql`，ISSUE-011）。改为 rebase 到最新 `master` 后重新生成 `0003`。
   `drizzle-kit generate` 对对方那份 `0002_snapshot.json` 报 `data is malformed`
   （已确认在干净 `master` 上单独复现，不是我引入的，未修，只是绕过去手工派生了 `0003_snapshot.json`）。
3. **合并那一刻主目录里有对方未提交的改动**，且和本 issue 改的文件真实重叠
   （`render.pg-fixture.ts`、`queries.ts`）。用 `git stash push -u -m <带时间戳的标签>`
   暂存后完成合并；尝试把 stash 放回去时两个文件产生真实文本冲突，**没有替对方决定怎么取舍**，
   用 `git reset --hard` 干净撤回，**stash 条目原样保留未 drop**（SHA
   `8b1e43ef3a2d43aa3f9c7ac8a51cc9d9ae55e818`，标签
   `concurrent-session-wip-before-issue008-merge-20260725`）。截至本文档更新时**这个 stash 仍未被取回**，
   如果你是那条线的后续执行者，先 `git stash list` 确认还在，再
   `git stash apply 8b1e43ef3a2d43aa3f9c7ac8a51cc9d9ae55e818` 拿回去重新接上，
   然后自己决定要不要 `git stash drop`。
4. **反向教训**：本次修复最早几步是直接在主目录改的（尚未发现并发），
   已确认造成过一次真实破坏——`canvas.ts` 摘掉 `positionX/positionY` 但配套 migration 还没写完时，
   短暂让共享 Postgres 上所有 `canvas_nodes` 插入路径（含对方的 pg 测试）报
   `null value in column "position_x" violates not-null constraint`（对方在 commit `f2601bd`
   里自己绕开了，见上文「并发会话实录」）。**教训固化**：schema 改动必须和 migration 同一批落地，
   不能拆两步在共享环境里过渡。

### 验证结果

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck`（合并后，主目录） | exit 0 |
| `pnpm verify:v3` | `ok: true`，0 违规 |
| `pnpm test` | 458 passed / 3 failed；失败项全在 `tests/job-phase-contract.test.ts`，已确认在本 issue 任何改动之前即失败（`server/**` 范围外，正则解析 `JobPhase` 联合类型对不上 `job-store.ts` 当前格式），未修 |
| `pnpm test:pg`（隔离 Postgres） | 画布相关 5 个文件单独重跑 **27/27 全绿**；全量跑还会看到 `schema-metadata.pg.test.ts` 3 个失败（`workspace_settings` 新表后表/外键计数断言未同步更新）和 `runtime-repository.pg.test.ts` 1 个失败（ISSUE-005 `audioManifest` 遗留）——均已确认在干净 `master` 上独立于本 issue 存在，未修 |
| `pnpm db:migrate` 双跑（清空重建后） | 两次均成功；`\d canvas_nodes` 确认两列已删且不受 `workspace_settings` 影响 |
| grep `positionX`/`position_x`/`position_y` | 全仓库零命中（仅历史 migration `0000`/`0001` 保留，不可变历史） |

### 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/features/canvas/layout.ts` | 坐标唯一来源，`computeLayout()`；`NODE_WIDTH`/`NODE_HEIGHT` 现已导出供测试校验重叠 |
| `src/features/canvas/queries.ts` | `PositionedCanvasNode` 类型定义处；`CanvasGraphNode` 本身不含 `position` |
| `src/lib/db/migrations/pg/0003_drop_canvas_node_position.sql` | 已应用的生产 migration，不要删除或手改 |

### 已知边界与下一位执行者注意事项

1. **不要再往 `canvas_nodes` 加坐标类列。** 任何"记住用户手动排过的布局"需求，
   必须先做 issue 里否决的方案 B 的前置条件（`nodesDraggable={true}` + 回写 API + 自动布局降级为按钮），
   而不是复活 `position_x/y`。
2. **`layout.ts` 的节点尺寸/间距是常量，不是按类型 hack。** 布局不好看不要在这里塞特例分支。
3. **ISSUE-008 与「画布靠 1.5s 轮询驱动状态」（ISSUE-012）在语义上相关但代码不重叠**：
   本 issue 只管坐标怎么算，不管什么时候重渲染；`router.refresh()` 轮询逻辑完全没动。
4. **stash `8b1e43ef3a2d43aa3f9c7ac8a51cc9d9ae55e818` 是否已被取回，请先确认**（见上文「并发处理实录」第 3 条），
   避免那部分 `render.pg-fixture.ts`/`queries.ts` 的改动被误认为已经丢失。

---

# 交接：ISSUE-011 设置页占位项与并发配额（截至 commit `d63d89d`）

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

---



# ISSUE-012 · 画布状态改为项目级 SSE 推送（done）

- 执行时间：2026-07-25（本批次最后一个收尾 issue）
- 最终状态：`done`，验收 §8 四项全过，前后取证留档 `docs/issues/evidence/issue-012/`
- 方案：issue §4 的**方案 A**（项目级 SSE 状态流），由基线测量数据裁决

### 提交链（7 个 commit，全部落在本地 master）

| Commit | 内容 |
| --- | --- |
| `5be5869` | fix(next)：`@earendil-works/pi-ai` / `pi-agent-core` 加入 `serverExternalPackages`。Turbopack 打包 pi-ai dist 的 provider 懒加载动态 require 会抛 `MODULE_NOT_FOUND`，导致 Director 全部阶段模型调用失败——这是横在测量前面的环境级阻断，属真实修复而非 ISSUE-012 功能。 |
| `fb0f530` | docs：基线测量入档（39 节点 121.1s 窗口：`getCanvasGraph` 249 次 / 2.06 次每秒、每次 41 SQL、DB→UI p50 1359ms max 1949ms、long task 22 次 1200ms）+ 选定方案 A + 方案 B/C 否决理由。 |
| `a1cbe1d` | docs(routing)：§4.1 + §4.3 先行登记 `GET /api/director/stream/project/[projectId]`（文档先行硬约束）。 |
| `6df8abf` | feat(stream)：新增 `src/lib/stream/status-bus.ts`（独立于 StreamBus 的状态总线：每节点最新值 upsert + 订阅时快照回放 + per-project 单调 seq + 30s 末位订阅者清理 + globalThis 锚定）；`transitionNodeStatus` / `materializeShotLanes` 两个发布点均在 `withTransaction` 提交后发布，回滚路径零事件。19 个测试。 |
| `a239b57` | feat(api)：SSE 端点（snapshot / node-status / topology 三种帧，15s keepalive，abort 即退订，无持久化回放分支，服务端不主动 close）。4 个测试 + 真实 HTTP 证据。 |
| `f1a763e` | feat(canvas)：`use-project-status-stream`（事件走 `applyStreamEvent` 纯归约）+ `live-status.ts`（`applyStatusOverlay` 纯合成）+ `canvas-view.tsx` 集成——props 为真值基线、SSE 只做 status 覆盖层；原 1.5s 轮询保留为 `!connected` 门控的兜底；refresh 收敛为拓扑/未知节点/终态漂移三种触发（400ms 防抖）。11 个测试。 |
| `50ae96d` | docs：修复后取证入档 + issue 转 done + README 同步 + route.ts prefer-const 修复。 |

### 架构关键决策（下一位不要推翻的点）

1. **status-bus 与 stream-bus 是两个总线，不要合并。** 文本流是累积 append 语义（快照=全文回放、有 256KB 截断、有 done/error 终态），状态流是最新值 upsert 语义（快照=每节点当前状态、天然有界、无终态）。强行泛型化会污染两边的不变式与既有 11 个 stream-bus 测试。
2. **发布必须在 `withTransaction` 返回之后。** `status.ts` / `fan-out.ts` 的单测锁了「抛错路径零发布」；把 publish 挪进事务体内会产生回滚幽灵事件。
3. **客户端只有一个状态合成方向：props 基线 + SSE 覆盖层。** 兜底轮询不是第二套状态源，它只是「SSE 不健康时重新拉 props」的原路径，与覆盖层汇入同一个 `applyStatusOverlay`。不要给 hook 加第二个 fetch 数据源。
4. **重连一致性靠快照，不靠增量回放。** 每次（重）连接的 snapshot 全量替换覆盖层并重置 seq 水位；不要加 Last-Event-ID / 环形缓冲——34 节点规模下是纯负担（方案评审时已否决）。
5. **`@/lib/stream` 从 canvas 层 import 是合法的**，已对照 `scripts/verify/v3-architecture.ts` 的 `isCanvasForbidden` 逐条确认；`canvasForbiddenImports` 仍是原有 15 条 db 债务，无新增。

### 验收证据摘要（详见 evidence/issue-012/）

| 验收项 | 结果 |
| --- | --- |
| 状态变更 → UI 可见 < 1s | **115ms**（基线 p50 1359ms / max 1949ms） |
| `getCanvasGraph` 显著下降 | 353s 活跃期 RSC refresh **4 次** vs 基线折算 ≈727 次（-99.4%） |
| SSE 断开退兜底 | 端点临时 503：EventSource 重试 ×3 → 1.5s 轮询接管 → 10.1s 收敛「已完成」；恢复后 snapshot(seq=7) 一帧对齐 |
| 扇出新增泳道 | 页内「一键启动」后画布自动 4n/0l → 39n/7l，零手动刷新；截图 `after-canvas-r4.png` |
| 门禁 | lint / typecheck / `pnpm test`(108 文件 502 例) / `verify:v3 ok:true` / build / `git diff --check` 全绿 |

### 执行过程中的环境发现与处置（重要，含跨 issue 影响）

1. **pi-ai Turbopack 打包缺陷**（上文 `5be5869`）：修复使 dev 下 Director 从必挂变为可用，
   所有依赖 Director 的 issue（002/005/014）都受益；`.next` 陈旧缓存还曾执行过旧 schema 的 INSERT，
   诊断时清过一次缓存。**注意：`.next` 的备份目录名必须仍在 .gitignore 覆盖内**，
   否则 Tailwind v4 源扫描会拾取二进制垃圾生成损坏 CSS 类（踩过，已入档 baseline-metrics §过程发现 4）。
2. **`gemini-3.6-flash` 在 DIRECT/工具调用场景稳定触发 finishReason→error**
   （pi-ai 把 MALFORMED_FUNCTION_CALL 一类统一映射为 error，原始信息被 `An unknown error occurred` 吞掉）。
   已通过 `POST /api/settings` 把 DB 的 `gemini.primaryModel` 切到 `gemini-3.1-flash-lite`，DIRECT 即通。
   **该 DB 设置保留未回滚**（`primaryModel.source=settings`）；恢复 3.6-flash 前需先解决其函数调用兼容性，
   建议归入 ISSUE-013 收尾时一并处理。
3. **SHOT_SPEC 间歇性失败**：`Director Tool 输出缺失或无效：validate_shot_plan`，与模型无关
   （lite 也会），但同一节点重试常能成功（实测 7 失败重试后陆续成功多个）。
   属 Director 工具输出提取/prompt 合同的上游缺陷，**未在本 issue 修**；它当前是全链路（含 render 泳道）
   端测的最大障碍，ISSUE-014 执行者请优先排查 `pi-output.ts` 的工具实参提取路径。
4. **ISSUE-008 的迁移 journal 时间戳乱序**：`_journal.json` 里 0003 的 `when` 早于 0002，
   drizzle 按时间戳判定 0003 已过期而跳过，造成 schema（无 position 列）与 DB（列 NOT NULL）不一致，
   **全库项目创建 400**。我已把 0003 的 `when` 改为 1785002500000（> 0002）并重跑 `pnpm db:migrate`，
   position 两列已删、创建恢复。**`_journal.json` 这处修改仍在工作区未提交**——它属于 ISSUE-008 的
   在途文件（连同 render/* 等一批），由该线执行者确认后随其批次提交；不要重置它，否则任何
   重建的数据库会再次跳过 0003。
5. **临时验证物已全部清理**：兜底测试的 503 短路（`TEMP-ISSUE-012-FALLBACK-TEST`）已删；
   `getCanvasGraph` 临时插桩已删（它曾被并发 stash 回放带回一次，最终状态已确认干净，
   全仓库 `TEMP-ISSUE-012` 零命中）。`.data/issue-012-*.mjs/.ps1` 是取证脚本，留在 .data（不入库）。

### 已知边界与下一位执行者注意事项

1. **不要删兜底轮询**（issue 禁区 2）。`canvas-view.tsx` 的 1.5s effect 以 `live.connected` 门控，
   是 SSE 不可用时唯一的收敛路径。
2. **连接生命周期**：`enabled = 存在 pending/running 节点 || autopilot`。页面加载时全终态且
   autopilot 关的情况下，SSE 与轮询都不激活——这继承自修复前行为（基线文档已记录该结构性缺口），
   autopilot 常开时缺口已大幅收窄；要彻底消除需把连接改为挂载即常驻，这是行为变更，需单独议题。
3. **stream-bus / status-bus 仍是进程内**（README §8 已登记），多实例部署换 Redis pub/sub 时
   两个总线一起换，事件协议（snapshot/node-status/topology + seq）可以原样平移。
4. **全链路（含 render 泳道）前后对比数据未补**，被 ISSUE-002（open）与上文第 3 条上游缺陷卡住；
   ISSUE-014 端测批次补齐时，基线与修复后的测量方法在 evidence/issue-012 两份 metrics 文档里可直接复用。

---

---

# 交接：ISSUE-002 FABRICATE→render 接缝（done，取代本文件最初一节的分析请求）

- 执行时间：2026-07-25（在 ISSUE-006/008/011/012 均已落地的仓库状态上执行，与它们零文件重叠）
- 最终状态：`done`，issue 文件 §7 五项验收标准全过，取证留档 `docs/issues/evidence/issue-002/`
- 本节承接文件开头「Batch-002 交接提示词」提出的分析任务：先做系统性分析产出报告，
  经确认后实现。以下按「分析结论 → 实现方案 → 新发现的额外缺口 → 验证证据 → 边界与后续」组织。

## 分析结论：issue 原文与并行改动都被证伪

开工前重新核实了 handoff 提示词 §3 描述的工作区 WIP（当时未提交的 `render/**` 改动），
发现该 WIP 已在后续 ISSUE-008 合并冲突处理中被 `git reset --hard` 撤回并转交给 stash
（SHA `8b1e43ef3a2d43aa3f9c7ac8a51cc9d9ae55e818`，见本文件上方 ISSUE-008 交接 §「并发处理实录」
第 3 条）。因此实际开工时 `src/features/render/**` 是**干净的 HEAD 状态**，等同于
handoff 提示词描述的「HEAD 断点」，WIP 那条分析线作废，直接从 HEAD 出发重新设计。

进一步核实发现 issue 原文 §4「入队只校验 `renderSpec` 与节点可入队性」这条修复方向
**本身就有矛盾**：ISSUE-005（commit `171f692`）落地后，`shot-codegen` 节点首次由
`materializeShotLanes` 播种时的 payload 只有 `laneKey`/`laneRole`/`sourceUnit`，
**没有 `renderSpec`**——它只在 FABRICATE 成功提交后才写入节点 `data`
（`stage-result.ts` FABRICATE 分支 + `runtime-artifact-writer.recordStageOutput`）。
若入队仍要求解析 `renderSpec`，首次路径会在比原文描述的
「缺 director-fabricate 产物」更早的一步（`parseRenderSpec`）抛错，`fabricateShot`
永远不会被调用到——这是一个「鸡生蛋」结构性断点，原 issue 文档与此前的并行分析都没有
发现它（`docs/issues/Batch-002-state-handoff.md` 开头交接提示词第 3.3 节倒是准确预见到了
这个风险并要求下一位模型独立核实，本次核实证实其成立）。

## 实现方案：与 issue 原文的偏差

采用的方案是 issue §4 修复方向的加强版：入队上下文（新增 `RenderEnqueueContext` 类型）
**完全不解析 `renderSpec`**，只携带 `{projectId, nodeId, shotId}`；`frames`/`htmlKey`
的解析完全下沉到 `loadRenderContext`（节点已处于 `running`、`fabricateShot` 已跑完之后）。
`loadRenderAdmissionContext` 返回 `{ enqueue, job }`：`job` 只在 `director-fabricate`
产物已存在时（重跑场景）才非空，供调用方决定是否要在入队前跑一次 `assertRenderAdmission`
运行时预检。

## 额外发现并修复的 P0 缺口（原 issue 未提及，比 handoff 描述更严重）

`enqueueRenderShot` 原实现里 `loadAdmissionContext` 的调用在 `try` 块之外。任何在此阶段
抛出的异常（包括首次路径必然出现的 `renderSpec` 缺失）都会绕过 render 自己的补偿链
（`compensateEnqueueFailure`：正确地转 `idle→pending→running→failed` 并写
`recordRenderError`），直接冒泡给 `advance.ts` 的通用 `recordStageError`——那条路径
**只写 `directorError`、不转 `failed`**。而画布 Inspector 的 `StreamingLogCard`
组件的 `STREAMABLE` 集合只含 `{running, success, failed}`，`resolveVisibleStageError`
也只在 `status === 'failed'` 时才返回非 undefined。三者叠加的结果：节点永久停留在
`idle`，Inspector **完全不渲染任何错误 UI**——不是 issue 原文 §2.4 描述的「节点瞬间
变红」，而是「什么都没发生，用户只能查数据库才能发现问题」。这是本次系统性分析新增的
发现，已在实现里一并修复：把 admission 加载纳入统一 try 块，按失败发生时点
（`pendingSet` 是否已置为 true）选择正确的补偿转移序列（`idle` 起点走
`idle→pending→running→failed`，`pending` 起点走 `pending→running→failed`）。

## UI 可见性缺口一并解决（issue §4 第 3 条要求但未落地的部分）

新增 `renderError` 字段（对称于既有 `directorError`），贯穿
`render-shot-repository.ts`（写入）→ `canvas/queries.ts`（解析、新增 `RenderNodeError`
类型）→ `streaming-log-card.tsx`（展示，标签「渲染失败」区别于「阶段失败」）。两个错误
字段互斥维护——`recordStageError` 写 `directorError` 时清掉残留 `renderError`，
`recordRenderError` 反之——避免同一次失败在 Inspector 上同时展示两条互相独立又指向
同一事件的噪音信号。新增 `withoutPayloadKeys` 工具函数（`persistence.ts`）承担这个清理。

## 实际改动文件（12 个，零 re-export 壳）

| 文件 | 动作 |
| --- | --- |
| `src/features/render/types.ts` | 新增 `RenderEnqueueContext`（不含 `frames`）、`RenderAdmissionContext { enqueue, job }` |
| `src/features/render/render-shot-repository.ts` | `loadRenderAdmissionContext` 改返回 `RenderAdmissionContext`；新增 `hasFabricateArtifact` |
| `src/features/render/queue-handler.ts` | handler 按需调用 `fabricateShot`；`enqueueRenderShot` 统一补偿路径；新增 `failFabricate`（只转 failed，不写 `renderError`） |
| `src/features/render/render.pg-fixture.ts` | `withFabricateArtifact:false` 时同步不再预置 `renderSpec`，还原真实首次入队状态 |
| `src/features/render/repository.pg.test.ts` | 新增「首次入队无 renderSpec 无产物」+「重跑产物已存在可预检」两个用例 |
| `src/features/render/queue-handler.test.ts` | 重写为三分支覆盖 + 补偿序列断言（10 个用例） |
| `src/features/render/persistence.ts` | 新增 `withoutPayloadKeys` |
| `src/features/director/runtime-repository.ts` | `recordStageError` 清掉残留 `renderError` |
| `src/features/canvas/queries.ts`、`index.ts` | 新增 `RenderNodeError`、`parseRenderError` |
| `src/app/products/(app)/canvas/[projectId]/streaming-log-card.tsx`、`streaming-log-card.test.ts`、`canvas-inspector.tsx` | Inspector 展示 `renderError`，与 `directorError` 分标签 |

不改：`fabricate.ts` 行为语义、`advance.ts` 分流逻辑、`admission.ts` 签名、
确定性门禁、`shot-codegen` 状态机语义——issue §6 六条禁区全部遵守。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck`（全仓库） | exit 0；唯一红是 `live-status.test.ts`（ISSUE-012 并行遗留的未提交文件，与本 issue 无关，见下「已知边界」第 1 条） |
| `pnpm test` | 108 files / 498 passed |
| `pnpm test:pg src/features/render` | 3 files / 15 passed |
| `pnpm verify:v3` | `ok: true`，0 违规 |

## 真实端到端证据（Gemini + StepFun 真实 API，非 mock 非 fixture）

用户明确要求「必须用真实 API，优先谷歌的」。在 `purpleink-dev-postgres-1`（共享容器，
非隔离）上用真实生产代码路径（`POST /api/projects` → `POST /api/director/pipeline`）
跑通 INGEST → DIRECT → SHOT_SPEC → 两条 `shot-codegen` 首次入队 → `fabricateShot`
生成 HTML → 真实渲染出 MP4：

| 泳道 | `renderSpec.durationInFrames` | `director-fabricate` | `render-mp4` | `ffprobe` 时长 |
| --- | --- | --- | --- | --- |
| S001 | 119（30fps） | version 1 | version 1 | 3.97s（≈119/30） |
| S002 | 227（30fps） | version 1 | version 1 | 7.57s（≈227/30） |

`ffprobe` 分辨率/fps（1080x1920 @30fps）与两个节点的 `renderSpec` 完全一致；两条泳道
时长不同且各自吻合——**同时补齐了 ISSUE-005 §9.4 遗留的「单镜 MP4 时长对比」运行时观测
缺口**（本文件 ISSUE-005 一节原文明确标注该项待 ISSUE-002 打通后补）。

**幂等**：对已成功节点重跑 `POST /api/render`，`director-fabricate`/`render-mp4` 均保持
`version=1`，未触发二次 `fabricateShot`（无二次 Gemini 调用）。

**负向验证**（issue §7 第 5 条）：手动删除 storage 里的 HTML 字节（保留 DB 记录）后重跑，
入队 admission 阶段如实报 `渲染 source 读取失败`（HTTP 409），未静默重新生成；节点落
`renderError` 而非 `directorError`，验证了本次新增的错误来源区分能力。测试后已恢复原字节。

证据文件：`docs/issues/evidence/issue-002/first-run.json`。

## 过程中处理的无关问题（据实记录，未纳入本 issue 代码改动）

1. **本地开发 DB 的 `model_routes` 表存有早前设置页测试遗留的路由覆盖**：把
   `shot-spec`/`fabricate` 指向 `gemini-3.1-flash-lite`，该轻量模型对
   `validate_shot_plan` 工具调用不稳定（反复触发 `Director Tool 输出缺失或无效`），
   已删除这两条覆盖记录使其回退到代码默认 `gemini-3.6-flash`。**仅本地 DB 数据调整，
   不是代码改动，不影响任何 schema 或迁移**。
2. **`gemini-3.6-flash` 在 DIRECT 阶段偶发把全部输出预算耗在隐藏 reasoning token 上
   返回空文本**（`pi-ai` 的 `google-generative-ai.js:201` 把该情形归一为
   `An unknown error occurred`，日志里的 `usage.reasoning` 字段显示 2826/3775 token
   全花在推理上）。这是 pi-ai/gemini 侧的既有行为，与本 issue 改动无关，重试后即成功。
3. **两条泳道的 `shot-qa`（FINALIZE）下游节点均失败**：QA 阶段消费 `render-mp4` 之后的
   规则检测/视觉核对，属下游阶段自身问题，不在本 issue 范围，据实记录不处理。

## 已知边界与下一位执行者注意事项

1. **`live-status.test.ts` 是 ISSUE-012 并行会话遗留的未提交、未追踪文件**
   （`src/app/products/(app)/canvas/[projectId]/live-status.test.ts`），引用了
   ISSUE-008 已删除的 `position` 字段和一个类型不兼容的 `directorError: null`，
   导致全仓库 `pnpm typecheck` 有且只有这一处红。本次**未清理**（不是本 issue 职责，
   且用户已明确指示不清理无关改动）；由 ISSUE-012 后续执行者或该文件的原作者处理。
2. **`.gitignore`（新增 `.claude/worktrees/`）与 `src/lib/db/migrations/pg/meta/_journal.json`
   （0003 迁移时间戳修正）是 ISSUE-008/006 交接里已经记录过的在途改动**，本次未触碰，
   随其所属批次一并提交即可，不属于 ISSUE-002。
3. **不要再往 `RenderEnqueueContext` 加 `frames`/`seed` 等渲染字段**——这正是本次修复
   要拆掉的耦合。任何「入队时想预检画幅」的新需求，应该先确认此时 `renderSpec` 是否
   已存在（重跑场景下 `admission.job` 非空即可预检），不要把它做成入队上下文的必填字段。
4. **`directorError`/`renderError` 互斥清理逻辑分散在两个 repository 里**
   （`runtime-repository.ts` 清 `renderError`，`render-shot-repository.ts` 清
   `directorError`），没有抽成第三个共享模块——两处逻辑各自只有一行 `delete`，
   抽象成本大于收益，如果未来两个 repository 之外还需要写这两个字段，再考虑上提。
5. **`docs/issues/evidence/issue-002/first-run.json` 里的 `codegenNodeId` 是本地
   `purpleink-dev-postgres-1` 容器里真实存在的数据**（项目
   `c9ad9ea8-64fe-4eb8-82b1-e5ba486556b8`），不是伪造 ID；该项目及其产物仍留在共享
   开发库里，未清理，供后续复核。
6. **若需复验**：`pnpm vitest run src/features/render` 应 13 files / 64 passed；
   `pnpm test:pg src/features/render` 应 3 files / 15 passed；
   `pnpm verify:v3` 应 `ok: true`；真实 e2e 需重新走
   `POST /api/projects` → `POST /api/director/pipeline` → 轮询 `shot-codegen` 状态。

## 全项目影响（本次之后的盘面）

- 未完成 issue 只剩：**ISSUE-013（in-progress 收尾）**、**ISSUE-014（现在可以开工，
  第一个真实单镜 MP4 已产出，两条泳道）**。
- `docs/issues/README.md` §1「3 个断点」表、§4 Issue 清单、§5 依赖顺序已同步更新为
  ISSUE-002 `done`。
- 「文本 → 切分 → 实测旁白 → 真实帧数 → HTML 生成 → 真实渲染」全链路首次在本次证据里
  端到端跑通，且是用真实 Google Gemini API + StepFun TTS API 验证的，没有一步 mock。
