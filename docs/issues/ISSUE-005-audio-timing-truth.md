# ISSUE-005 · `audio-demo` 编造固定 8 秒/镜时长，TTS 时序颠倒

- 优先级：**P1**
- 状态：`open`
- 范围：`src/features/director` 的 INGEST 结果构造 + `src/features/audio`。**不得触碰 `server/**`**
- 依赖：ISSUE-001、ISSUE-002（要先能跑通才能验真实时长）
- 关联：本 issue 是 AGENTS.md §6「不得接假数据」的直接违规修复

## 1. 症状

成片时长与真实旁白**完全无关**。

每个分镜恒定 8 秒、30fps、240 帧，无论该分镜的文本是 5 个字还是 200 个字。
文本长的分镜会出现「旁白还没说完就切镜」，文本短的会出现「画面干等」。

## 2. 证据

### 2.1 INGEST 阶段直接编造 audio manifest

`src/features/director/audio-demo.ts:10-31`

```ts
const DEFAULT_UNIT_DURATION_MS = 8000
const DEFAULT_FPS = 30
const DEFAULT_SAMPLE_RATE_HZ = 24000

export function buildDemoAudioManifest(scriptUnits: ScriptUnit[]): AudioManifest {
  const totalMs = DEFAULT_UNIT_DURATION_MS * scriptUnits.length
  const manifest: AudioManifest = {
    version: 1,
    engine: 'demo-tts',                              // <- 假引擎名
    units: scriptUnits.map((unit) => ({
      unitId: unit.unitId,
      text: unit.text,
      audioFile: 'project://audio/demo.mp3',         // <- 不存在的文件
      durationMs: DEFAULT_UNIT_DURATION_MS,          // <- 恒定 8000
      source: 'tts',
      sampleRateHz: DEFAULT_SAMPLE_RATE_HZ,
      sampleCount: (DEFAULT_UNIT_DURATION_MS * DEFAULT_SAMPLE_RATE_HZ) / 1000,
    })),
    totalMs,
  }
  return audioManifestSchema.parse(manifest)
}
```

`audio-demo.ts:33-63` 的 `buildDemoAudioAllocation` 同理，
`durationInFrames` 恒为 `round(8000 * 30 / 1000) = 240`，
`allocationMethod` 写成 `'duration-weight-fallback'`。

### 2.2 假数据被直接当成阶段产物提交

`src/features/director/stage-result.ts:35-50`

```ts
if (context.stage === 'INGEST') {
  const parsed = ingestStageResultSchema.parse(parseJsonObject(rawContent))
  const audioManifest = buildDemoAudioManifest(parsed.scriptUnits)        // <- 假
  const audioAllocation = buildDemoAudioAllocation(parsed.scriptUnits, audioManifest)
  return {
    content: JSON.stringify({ scriptUnits: parsed.scriptUnits, audioManifest, audioAllocation }),
    ...
```

这个 artifact 会以 `kind='director-ingest'` 落库，`content_hash` 是真的，**但内容是编的**。

### 2.3 编造的时长直接决定渲染帧数

`src/features/director/stage-result.ts:52-70`（FABRICATE 分支）

```ts
renderSpec: renderSpecSchema.parse({
  fps: input.audioAllocation.fps,                 // <- 来自假 allocation
  durationInFrames: allocation.durationInFrames,  // <- 恒 240
  ...resolutionForPreset(MASTER_RESOLUTION_PRESET),
  seed: stableSeed(context.projectId, context.nodeId, input.shot.id),
})
```

`renderSpec` 存进节点 `data`，被 `render-shot-repository.ts:99-110` 读出，
成为 Playwright 的逐帧循环次数与 ffmpeg 的帧数上限。
**所以「假时长」不是显示问题，它决定了真实 MP4 的真实长度。**

### 2.4 真 TTS 存在，但跑得太晚

真实语音合成在 `ASSEMBLE` 阶段的 `shot-sfx` 节点：

- `src/features/director/stage-effects.ts:85-95` 装配 `generateVoiceover`
- `src/features/audio/voiceover.ts` → `src/features/audio/stepfun-audio-client.ts`
  调 StepFun `stepaudio-2.5-tts`

阶段顺序是 `INGEST → DIRECT → SHOT_SPEC → FABRICATE → ASSEMBLE → FINALIZE`。
`FABRICATE` 已经按 240 帧渲完 MP4 了，`ASSEMBLE` 才去合成真实音频——
此时无论真实音频多长，画面帧数都已固化。**这是时序颠倒，不是精度问题。**

### 2.5 AGENTS.md 明文禁止

> 不得接假数据库、假认证或假引擎。
> UI 可见字段必须可追溯到 API、数据库投影、Artifact，或明确标注的未接线占位。
> fixture、mock、真实 API / 模型调用必须分别标注。

`engine: 'demo-tts'` 与 `audioFile: 'project://audio/demo.mp3'` 属于假引擎 + 不存在的产物引用，
且没有在任何 UI 上标注为占位。

## 3. 根因

INGEST 需要「每个 script unit 的音频时长」来分配帧数，
但真实时长只有在 TTS 合成之后才知道。
迁移期为了让链路能编译通过，用固定值把这个洞填上了，从此形成
「先编时长 → 按编的时长渲染 → 事后才合成真音频」的错误时序。

要修的是**顺序**，不是数值。

## 4. 修复方向

把真实 TTS 从 `ASSEMBLE` 前移到 `INGEST`，让 `audioManifest` / `audioAllocation`
从**实测音频字节**派生。

```text
现状
  INGEST     LLM 切分 scriptUnits -> buildDemoAudioManifest(编 8000ms)
  FABRICATE  按 240 帧生成 HTML 并渲染
  ASSEMBLE   shot-sfx 才真实合成语音（时长已无处可用）

修复后
  INGEST     LLM 切分 scriptUnits
             -> 对每个 unit 真实调用 TTS，落成音频 artifact
             -> 用实测 durationMs / sampleCount 构造 audioManifest 与 audioAllocation
             -> durationInFrames = ceil(实测 durationMs * fps / 1000)
  FABRICATE  按真实帧数生成 HTML 并渲染
  ASSEMBLE   shot-sfx 复用 INGEST 已产出的语音 artifact（不重复合成）
```

### 4.1 实现要点

1. **时长必须来自音频字节本身**，不是来自 TTS 接口自报的数字，也不是按字数估算。
   用 `ffprobe`（`ffmpeg-static` 已在依赖内）或音频容器头解析。
   `content_hash` 必须是该音频实际字节的 SHA-256。
2. **TTS 调用要并发**。INGEST 阶段一次要合成 N 个 unit，
   串行会让 INGEST 变成整条链路最慢的一步。并发上限与 ISSUE-004 的通道语义保持一致。
3. **幂等与复用**。同一 unit 文本 + 同一 voice + 同一模型应命中已有音频 artifact，
   不重复计费。可复用 `src/features/render/cache.ts` 的思路（按输入 hash 查缓存）。
4. **`shot-sfx` 改为消费而非生产**。`stage-effects.ts` 里 `generateVoiceover` 的职责需要重新划分：
   要么改成「读取 INGEST 已产出的语音并做混音/音效」，要么在 INGEST 已产出时短路跳过。
   **不允许两处都合成**，否则会出现两份不同的语音。
5. **`allocationMethod` 要如实**。当前恒为 `'duration-weight-fallback'`，
   改为反映真实来源（例如 `measured`）；若 schema 未包含该枚举值，同步扩展
   `src/features/director/schemas/ingest.ts`。
6. **删除 `audio-demo.ts`**，不要留成「可选 fallback」。留着就会被重新用上。
7. **失败即失败**。TTS 不可用时 INGEST 必须失败并落 `directorError`，
   **不得**回退到 8 秒占位。

### 4.2 若本轮无法完成真实前移（降级方案）

不接受静默保留现状。至少必须：

- `audioManifest.engine` 与 `allocationMethod` 如实标注为占位；
- 画布 Inspector 与导出页**显式显示**「时长为占位值，非真实旁白时长」；
- 在本文件记录降级决定与恢复计划。

但本 issue 的目标是**真实前移**，降级方案仅作为交付受阻时的兜底。

## 5. 修复范围

| 文件 | 动作 |
| --- | --- |
| `src/features/director/audio-demo.ts` | **删除** |
| `src/features/director/stage-result.ts` | INGEST 分支改为消费实测音频结果；不再调用 demo 构造器 |
| `src/features/director/schemas/ingest.ts` | `allocationMethod` 等枚举按真实来源扩展；必要字段收紧 |
| `src/features/director/stage-runner.ts` 或新增 INGEST effect | INGEST 需要一个「合成 + 实测 + 落 artifact」的副作用挂点；注意 `prepareStageResult` 目前是同步纯函数，前移 TTS 需要异步路径 |
| `src/features/audio/**` | 暴露「按文本批量合成 + 实测时长 + 落 artifact + 按 hash 复用」的公开导出 |
| `src/features/director/stage-effects.ts` | `shot-sfx` 改为消费 INGEST 产物，避免二次合成 |
| `src/features/director/runtime-artifact-reader.ts` | `resolveAssembleInput` 对 `shot-sfx` 的输入需要指向已产出的语音 artifact |
| 相关 `.test.ts` | 覆盖：不同长度文本得到不同帧数；TTS 失败时 INGEST 失败；重复文本命中缓存 |

> **注意**：`prepareStageResult` 当前是同步函数（`stage-result.ts:31`），
> 而 TTS 是异步的。这是本 issue 最大的结构性改动点——
> 需要决定是把 TTS 放进 `runStageEffect`（已是异步）并让 allocation 在 effect 后回填，
> 还是把 `prepareResult` 改成异步。**先给出方案再动手**，不要边写边定。

## 6. 禁区

1. 不用字数估算时长（`text.length * k` 之类）冒充实测。
2. 不用 TTS 接口返回的 `duration` 字段代替对实际字节的测量。
3. 不保留 `audio-demo.ts` 作为 fallback。
4. 不在 `FABRICATE` 之后再修正帧数——那会让已渲染的 MP4 与 allocation 不一致。
5. 不动 `server/src/tts/**`（那是后端智能体的 ListenHub 链路，与本处 StepFun 链路无关）。
6. 不因为 TTS 慢就把并发写死成 1（见 ISSUE-004）。

## 7. 验收标准

1. `pnpm test`、`pnpm test:pg`、`pnpm typecheck` 全绿；`pnpm verify:v3` 违规数不增加。
2. 全仓库 grep `demo-tts`、`project://audio/demo.mp3`、`buildDemoAudio` **零命中**。
3. **真实证据**：用一个含**长短差异明显**的 script（例如一段 10 字、一段 120 字）跑通 INGEST：
   - `director-ingest` artifact 里两个 unit 的 `durationMs` **明显不同**；
   - 每个 unit 对应一个真实音频 artifact，`ffprobe` 测得时长与 manifest 记录一致（允许 ±1 帧误差）；
   - `content_hash` 与音频实际字节 SHA-256 一致；
   - 两个分镜的 `renderSpec.durationInFrames` 不同；
   - 渲出的两个单镜 MP4 时长不同，且各自与对应旁白时长吻合；
   - `shot-sfx` 阶段**没有**产生第二份语音 artifact。
   证据（含 `ffprobe` 输出与 SQL 查询）留档到 `docs/issues/evidence/issue-005/`。
4. 负向验证：临时置空 `STEP_API_KEY`，INGEST 必须如实失败并落 `directorError`，
   **不得**产生 8 秒占位或任何 artifact。
5. 无法完成第 3 项时说明原因，不得声称已验证。

## 8. 备注

这是链路里唯一的**时序性架构错误**，其余问题都是接线或收敛。
用户已确认本轮修复，不走降级方案。
