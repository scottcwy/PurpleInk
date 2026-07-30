# Procedural SFX Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不增加音乐、模型调用、节点或队列的前提下，为 script、audio、website 三条视频链路加入可验证、可关闭、由代码确定性生成的短音效。

**Architecture:** 使用一个独立 workspace 纯函数包生成确定性的边界 cue 与 48 kHz PCM WAV 字节。script/audio 在现有 `concatExport`，website 在现有 `muxNarration` 内将 one-shot 通过 ffmpeg `adelay + amix + alimiter` 混入；音效失败只回退到原旁白成片。设置、导出指纹、worker 请求和 Artifact manifest 都记录同一 mode/version/hash，UI 只显示 manifest 能证明的最新成片事实。

**Tech Stack:** TypeScript strict、pnpm workspace、Vitest、Postgres/Drizzle、ffmpeg、Next.js 16、React。

---

## Scope and invariants

- 只实现 `soundEffects: 'off' | 'procedural'`，不增加音乐、音量、风格或密度设置。
- 不改变现有 `shot-sfx`、`shot-score` 节点拓扑，也不把 LLM 自由文本当作声音事实。
- cue 只来自真实镜头/场景边界；相同 timeline、mode 和 generator version 必须产生完全相同的 WAV、cue plan hash 与 MP4 输入指纹。
- 存量项目默认 `off`；新项目由创建合同显式写入 `procedural`，避免旧输出静默改变。
- 未知/无 cue 是成功的 `omitted-*`；仅 SFX 分支失败可回退，基础视频、旁白或 mux 失败仍按现有失败合同终止。
- `procedural-sfx-json` 必须与最终 MP4 绑定同一 attempt 和 `finalContentHash`；旧 manifest 不得描述新成片。
- website 在启动时快照 mode/version，不能在导出页事后伪称开关改变了已经 mux 完成的 MP4。

## File map

- Create `packages/procedural-sfx/package.json`: 两个运行时共同依赖的纯 ESM 包边界。
- Create `packages/procedural-sfx/src/index.ts`: cue、manifest、结果类型和公开导出。
- Create `packages/procedural-sfx/src/plan.ts`: 由帧时间线生成受限、确定性 cue plan。
- Create `packages/procedural-sfx/src/wav.ts`: 生成 48 kHz mono PCM s16 one-shot WAV。
- Create `packages/procedural-sfx/src/*.test.ts`: 字节确定性、边界、密度和 hash 测试。
- Modify `pnpm-workspace.yaml`, root/server `package.json`, `pnpm-lock.yaml`: 登记共享包。
- Modify `src/features/canvas/export-settings.ts`: 增加兼容默认和局部 PATCH。
- Modify `src/features/render/media-assembly.ts`, `media-assembly-loader.ts`: 把真实帧时间线和 mode 送入装配。
- Modify `src/features/render/media-ffmpeg-args.ts`, `concat.ts`: one-shot 输入与混音。
- Modify `src/features/render/export-readiness.ts`, `export-service.ts`, `repository.ts`: 指纹、manifest 与 final hash 绑定。
- Modify `src/features/website/website-queue-handler.ts`, `engine-client.ts`, `website-output.ts`: website 设置快照与安全结果投影。
- Modify `server/src/server/internal-render-request.ts`, `job-store.ts`, `compose/run-pipeline.ts`, `tts/narration.ts`: worker 参数、mux 和 SFX 结果。
- Modify `src/app/products/(app)/export/[projectId]/*`: script/audio 设置与最新交付事实。
- Modify `src/features/website/website-delivery-preview.tsx`, `website-export-model.ts`: website 成片音效事实。
- Modify `docs/conventions/project-workflows.md`, `workflow-failure-patterns.md`: 合同与降级模式。

### Task 1: Define settings and versioned shared contract

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `server/package.json`
- Create: `packages/procedural-sfx/package.json`
- Create: `packages/procedural-sfx/src/index.ts`
- Modify: `src/features/canvas/export-settings.ts`
- Test: `src/features/canvas/export-settings.test.ts`

- [ ] **Step 1: Write failing compatibility tests**

```ts
it('keeps stored resolution and subtitles when soundEffects is absent', () => {
  expect(resolveExportSettings({
    resolutionPreset: '1280x720',
    subtitles: 'off',
  })).toEqual({
    resolutionPreset: '1280x720',
    subtitles: 'off',
    soundEffects: 'off',
  })
})

it('patches only soundEffects', () => {
  expect(mergeExportSettings(DEFAULT_EXPORT_SETTINGS, {
    soundEffects: 'procedural',
  })).toMatchObject({
    resolutionPreset: '1920x1080',
    subtitles: 'burn-in',
    soundEffects: 'procedural',
  })
})
```

- [ ] **Step 2: Run the RED test**

Run: `pnpm exec vitest run src/features/canvas/export-settings.test.ts`

Expected: FAIL because `soundEffects` is not in `ExportSettings`.

- [ ] **Step 3: Add the strict setting**

```ts
export const SOUND_EFFECT_MODES = ['off', 'procedural'] as const
export type SoundEffectMode = (typeof SOUND_EFFECT_MODES)[number]

export interface ExportSettings {
  resolutionPreset: ResolutionPreset
  subtitles: SubtitleDeliveryMode
  soundEffects: SoundEffectMode
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolutionPreset: MASTER_RESOLUTION_PRESET,
  subtitles: 'burn-in',
  soundEffects: 'off',
}
```

Add `.default('off')` to the strict stored schema and an optional field to the PATCH schema. Export the type/constants through the existing canvas public boundary.

- [ ] **Step 4: Create the shared package contract**

```ts
export const PROCEDURAL_SFX_GENERATOR_VERSION = 'procedural-sfx/1.0.0'

export type ProceduralSfxPreset = 'tick' | 'whoosh' | 'impact' | 'ping'

export interface ProceduralSfxCue {
  preset: ProceduralSfxPreset
  atFrame: number
  gainDb: number
}

export interface ProceduralSfxPlan {
  generatorVersion: typeof PROCEDURAL_SFX_GENERATOR_VERSION
  fps: number
  totalFrames: number
  cues: ProceduralSfxCue[]
  timingHash: string
  cuePlanHash: string
}

export type ProceduralSfxStatus =
  | 'applied'
  | 'omitted-off'
  | 'omitted-no-cues'
  | 'omitted-unsupported'
  | 'omitted-error'
```

The package must have no Node filesystem, database, provider or `server-only` imports.

- [ ] **Step 5: Run tests and typechecks**

Run:

```powershell
pnpm exec vitest run src/features/canvas/export-settings.test.ts
pnpm typecheck
pnpm --dir server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add pnpm-workspace.yaml package.json server/package.json pnpm-lock.yaml packages/procedural-sfx src/features/canvas/export-settings.ts src/features/canvas/export-settings.test.ts src/features/canvas/index.ts
git commit -m "feat(audio): 定义最小代码音效合同"
```

### Task 2: Generate deterministic cues and WAV bytes

**Files:**
- Create: `packages/procedural-sfx/src/plan.ts`
- Create: `packages/procedural-sfx/src/wav.ts`
- Test: `packages/procedural-sfx/src/plan.test.ts`
- Test: `packages/procedural-sfx/src/wav.test.ts`

- [ ] **Step 1: Write RED tests for plan limits**

```ts
const input = {
  fps: 30,
  totalFrames: 300,
  boundaries: [0, 90, 180, 270],
}

expect(buildBoundaryCuePlan(input)).toMatchObject({
  fps: 30,
  totalFrames: 300,
  cues: [
    { preset: 'ping', atFrame: 9, gainDb: -24 },
    { preset: 'whoosh', atFrame: 90, gainDb: -24 },
    { preset: 'tick', atFrame: 180, gainDb: -26 },
    { preset: 'impact', atFrame: 270, gainDb: -24 },
  ],
})
expect(buildBoundaryCuePlan(input)).toEqual(buildBoundaryCuePlan(input))
```

Also test invalid fps/frame values, duplicate boundaries, cues closer than 250 ms, and the full-video cue cap.

- [ ] **Step 2: Run the RED tests**

Run: `pnpm --filter @purpleink/procedural-sfx test`

Expected: FAIL because the generator is not implemented.

- [ ] **Step 3: Implement normalized planning**

```ts
const MIN_GAP_SECONDS = 0.25
const MAX_CUES = 24

export function buildBoundaryCuePlan(input: {
  fps: number
  totalFrames: number
  boundaries: readonly number[]
}): ProceduralSfxPlan {
  const minimumGap = Math.ceil(input.fps * MIN_GAP_SECONDS)
  const boundaries = [...new Set(input.boundaries)]
    .filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < input.totalFrames)
    .sort((a, b) => a - b)
  const selected = boundaries
    .filter((frame, index, all) => index === 0 || frame - all[index - 1] >= minimumGap)
    .slice(0, MAX_CUES)
  // map index/position to the fixed preset palette, then hash canonical JSON
}
```

No `Date`, `Math.random`, attempt ID or request ID may enter the canonical hash.

- [ ] **Step 4: Write RED byte tests**

```ts
const first = synthesizeProceduralWav({ preset: 'whoosh', seed: 'abc' })
const second = synthesizeProceduralWav({ preset: 'whoosh', seed: 'abc' })
expect(first).toEqual(second)
expect(Buffer.from(first).subarray(0, 4).toString('ascii')).toBe('RIFF')
expect(readWavInfo(first)).toMatchObject({
  sampleRate: 48_000,
  channels: 1,
  bitsPerSample: 16,
})
```

- [ ] **Step 5: Implement bounded synthesis**

Generate only the fixed one-shots using sine sweep, seeded xorshift noise and attack/decay envelopes. Clamp every sample to `[-1, 1]`; write a canonical PCM s16 WAV header. Durations: tick 90 ms, ping 180 ms, impact 240 ms, whoosh 320 ms.

- [ ] **Step 6: Run and commit**

```powershell
pnpm --filter @purpleink/procedural-sfx test
pnpm typecheck
pnpm --dir server typecheck
git add packages/procedural-sfx
git commit -m "feat(audio): 生成确定性短音效"
```

### Task 3: Mix SFX into script/audio final export

**Files:**
- Modify: `src/features/render/media-assembly.ts`
- Modify: `src/features/render/media-assembly-loader.ts`
- Modify: `src/features/render/local-media.ts`
- Modify: `src/features/render/concat.ts`
- Modify: `src/features/render/media-ffmpeg-args.ts`
- Test: `src/features/render/media-ffmpeg-args.test.ts`
- Test: `src/features/render/media-assembly-loader.test.ts`

- [ ] **Step 1: Write RED assembly and ffmpeg tests**

```ts
expect(plan.soundEffects).toEqual({
  mode: 'procedural',
  fps: 30,
  totalFrames: 270,
  boundaries: [0, 90, 180],
})

expect(args.join(' ')).toContain('adelay=')
expect(args.join(' ')).toContain('amix=inputs=')
expect(args.join(' ')).toContain('alimiter=limit=')
expect(args.join(' ')).not.toContain('stream_loop')
```

Keep an exact off-path assertion proving the existing arguments do not change when mode is `off`.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run src/features/render/media-assembly-loader.test.ts src/features/render/media-ffmpeg-args.test.ts`

Expected: FAIL because plans and args do not contain SFX.

- [ ] **Step 3: Add temp one-shot materialization**

`concatExport` must build the cue plan from `timeline.shots[].durationInFrames`, write only the short WAV files into its existing `.cvc-assembly-*` work directory, and pass `{ path, atFrame, gainDb }[]` to the argument builder. Its `finally` already removes the directory.

- [ ] **Step 4: Add the isolated ffmpeg branch**

For each cue input:

```ts
`[${inputIndex}:a:0]aresample=48000,` +
`aformat=sample_rates=48000:channel_layouts=stereo,` +
`volume=${gainDb}dB,adelay=${delayMs}|${delayMs}[sfx${index}]`
```

Mix all cue labels to `[sfxbus]`, apply `alimiter=limit=0.891251`, then mix narration plus SFX to `[audio]` with `duration=first:normalize=0`. Music remains absent and its current reserved path is not activated.

- [ ] **Step 5: Implement SFX-only fallback**

Catch only a typed `ProceduralSfxMixError`. On that error, call the same ffmpeg builder once with an empty SFX list and return `omitted-error`; do not catch missing narration, video, ffmpeg launch or final encode failures.

- [ ] **Step 6: Run and commit**

```powershell
pnpm exec vitest run src/features/render/media-assembly-loader.test.ts src/features/render/media-ffmpeg-args.test.ts
pnpm typecheck
git add src/features/render
git commit -m "feat(render): 在终片装配中混入代码音效"
```

### Task 4: Bind manifest, final hash and export idempotency

**Files:**
- Modify: `src/features/render/export-readiness.ts`
- Modify: `src/features/render/export-service.ts`
- Modify: `src/features/render/repository.ts`
- Create: `src/features/render/procedural-sfx-manifest.ts`
- Test: `src/features/render/export-readiness.test.ts`
- Test: `src/features/render/export-service.pg.test.ts`

- [ ] **Step 1: Write RED fingerprint tests**

```ts
expect(fingerprint({ soundEffects: 'off' }))
  .not.toBe(fingerprint({ soundEffects: 'procedural' }))
expect(fingerprint({ generatorVersion: 'procedural-sfx/1.0.0' }))
  .not.toBe(fingerprint({ generatorVersion: 'procedural-sfx/1.0.1' }))
expect(fingerprint({ cuePlanHash: 'a'.repeat(64) }))
  .not.toBe(fingerprint({ cuePlanHash: 'b'.repeat(64) }))
```

The canonical export input must include `soundEffects`, generator version, timing hash and cue plan hash.

- [ ] **Step 2: Write RED Postgres lineage test**

Export a real fixture and assert:

```ts
expect(finalArtifact.attemptId).toBe(manifestArtifact.attemptId)
expect(manifest.finalContentHash).toBe(finalArtifact.contentHash)
expect(manifest.cuePlanHash).toMatch(/^[0-9a-f]{64}$/u)
expect(manifest.status).toBe('applied')
```

Then register a newer final artifact and assert the old manifest is not projected as its `finalSoundEffects`.

- [ ] **Step 3: Implement the versioned manifest**

```ts
export interface ProceduralSfxManifestV1 {
  schema: 'cvc.procedural-sfx/v1'
  mode: 'off' | 'procedural'
  status: ProceduralSfxStatus
  generatorVersion: string
  cueCount: number
  laneKeys: string[]
  timingHash: string | null
  cuePlanHash: string | null
  waveformHashes: string[]
  finalContentHash: string
  failureCode?: 'PROCEDURAL_SFX_MIX_FAILED'
}
```

Serialize canonical JSON, calculate SHA-256 from the actual bytes, and register kind `procedural-sfx-json` only after the final MP4 bytes and hash are known.

- [ ] **Step 4: Preserve rollback**

Store MP4 and manifest first, then register both inside the existing export transaction boundary. If registration fails, remove only the two newly written keys. Never update or delete an approved/released record.

- [ ] **Step 5: Run and commit**

```powershell
pnpm exec vitest run src/features/render/export-readiness.test.ts
pnpm exec vitest run --config vitest.pg.config.ts src/features/render/export-service.pg.test.ts
pnpm typecheck
git add src/features/render
git commit -m "feat(render): 绑定音效清单与成片哈希"
```

### Task 5: Apply the same contract in website worker

**Files:**
- Modify: `src/features/website/website-queue-handler.ts`
- Modify: `src/features/website/engine-client.ts`
- Modify: `src/features/website/website-output.ts`
- Modify: `server/src/server/internal-render-request.ts`
- Modify: `server/src/server/job-store.ts`
- Modify: `server/src/compose/run-pipeline.ts`
- Modify: `server/src/tts/narration.ts`
- Test: `src/features/website/website-queue-handler.test.ts`
- Test: `tests/worker-internal-integration.test.ts`
- Test: `server/src/compose/run-pipeline.test.ts`

- [ ] **Step 1: Write RED request snapshot tests**

```ts
expect(enqueued.payload).toMatchObject({
  soundEffects: 'procedural',
  sfxGeneratorVersion: 'procedural-sfx/1.0.0',
})
expect(enqueued.fingerprint).not.toBe(offFingerprint)
```

Unknown modes and versions at the internal worker boundary must be rejected with a safe 400 response.

- [ ] **Step 2: Add safe worker result fields**

```ts
interface WebsiteSfxResult {
  status: ProceduralSfxStatus
  cueCount: number
  generatorVersion: string
  timingHash: string | null
  cuePlanHash: string | null
}
```

Only this allowlist may cross from worker to Next. Do not return WAV paths, source URL, prompt, raw ffmpeg error or credentials.

- [ ] **Step 3: Mix at the existing narration mux**

Derive boundaries from normalized `VideoModel.scenes[].start`, quantize them to the output fps, generate the same one-shots, and pass them into the existing `muxNarration`. `off` must execute the byte-for-byte existing narration-only argument path.

- [ ] **Step 4: Isolate fallback**

If only the SFX branch fails, rerun narration mux without SFX and return `omitted-error`. If narration download, base MP4 or base mux fails, preserve the existing terminal failure.

- [ ] **Step 5: Persist the same manifest**

`website-output.ts` uses the actual MP4 content hash to write `cvc.procedural-sfx/v1` with the same attempt. Approved website download remains gated by the approved MP4; the manifest is diagnostic/delivery metadata, never a substitute video.

- [ ] **Step 6: Run and commit**

```powershell
pnpm exec vitest run src/features/website/website-queue-handler.test.ts tests/worker-internal-integration.test.ts
pnpm --dir server test
pnpm typecheck
pnpm --dir server typecheck
git add src/features/website server/src/server server/src/compose server/src/tts tests/worker-internal-integration.test.ts
git commit -m "feat(website): 在网站成片中复用代码音效"
```

### Task 6: Expose honest settings and delivery facts

**Files:**
- Modify: `src/app/products/(app)/export/[projectId]/export-readiness-contract.ts`
- Modify: `src/app/products/(app)/export/[projectId]/export-api.ts`
- Modify: `src/app/products/(app)/export/[projectId]/use-export-runtime.ts`
- Modify: `src/app/products/(app)/export/[projectId]/export-settings.tsx`
- Modify: `src/app/products/(app)/export/[projectId]/export-workspace.tsx`
- Modify: `src/features/website/website-export-model.ts`
- Modify: `src/features/website/website-delivery-preview.tsx`
- Test: corresponding colocated tests

- [ ] **Step 1: Write RED runtime tests**

Test `off → procedural` sends only:

```json
{ "exportSettings": { "soundEffects": "procedural" } }
```

On 4xx/5xx, the visible toggle returns to the server value and shows a safe error. Also add `narration-no-subtitle-v3` to the existing delivery union before adding any SFX presentation.

- [ ] **Step 2: Project both intent and fact**

```ts
interface ExportSoundEffectsProjection {
  soundEffects: 'off' | 'procedural'
  finalSoundEffects: {
    status: ProceduralSfxStatus
    cueCount: number
    laneKeys: string[]
    generatorVersion: string
  } | null
}
```

`soundEffects` means the next export setting. `finalSoundEffects` means the latest MP4 whose hash matches the manifest. Never infer “applied” from `shot-sfx` node success.

- [ ] **Step 3: Add the single control**

Use the registered Toggle primitive:

- off: `本次不入片`
- procedural before export: `代码音效 · 待导出`
- applied: `代码音效 · N 个`
- omitted: `已完成 · 音效未加入`

The music track remains disabled with `接口预留 · 未实现`; do not add a music control.

- [ ] **Step 4: Update website delivery**

The website export page shows only a status pill and cue count because it has no trusted editor timeline. Changing the setting after a successful website export must say `重新生成后生效`, not mutate the old delivery fact.

- [ ] **Step 5: Browser component verification and commit**

Run focused tests, open both export page kinds in Chromium, toggle SFX, reload, and verify no console errors or fake applied state.

```powershell
git add src/app/products/\(app\)/export src/features/website
git commit -m "feat(export): 展示真实代码音效交付状态"
```

### Task 7: Document, regress and prove all three workflows

**Files:**
- Modify: `docs/conventions/project-workflows.md`
- Modify: `docs/conventions/workflow-failure-patterns.md`
- Add focused integration tests only where the previous tasks do not already cover a seam

- [ ] **Step 1: Document the failure pattern**

Add one recurring pattern: “SFX enhancement failure must not hide base mux failure or claim applied after fallback.” Include the diagnostic order: final Artifact → matching manifest → actual bytes/hash → ffprobe audio → safe attempt failure.

- [ ] **Step 2: Run real E2E**

Create new script, website and audio projects with `soundEffects=procedural`. For each:

1. One start request only; observe real nodes/attempts to terminal.
2. Verify manifest attempt equals final MP4 attempt.
3. Download with HTTP 200, `video/mp4`, attachment filename and matching SHA-256.
4. Run `ffprobe` for H.264, 1920×1080, AAC 48 kHz stereo, duration.
5. Run ffmpeg `ebur128`/`astats`; require master peak no greater than -1 dBFS tolerance and audible energy at cue windows.
6. Extract audio around a cue and a non-cue interval; confirm the cue window differs while no continuous music bed exists.
7. Re-run the same input and verify deterministic cue/waveform hashes and idempotent attempt reuse.
8. Switch `procedural → off`, export/regenerate, and prove the new MP4 has a different input fingerprint and an honest `omitted-off` manifest.
9. Check Chromium console/network: no unhandled errors, no infinite polling, no stale applied state.

- [ ] **Step 3: Run full gates**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:pg
pnpm verify:v3
pnpm build
pnpm --dir server typecheck
pnpm --dir server test
git diff --check
```

Run migrations twice if any schema migration was introduced. Scan `AGENTS.md README.md docs src server scripts packages` for U+FFFD. A skipped real E2E remains unaccepted.

- [ ] **Step 4: Commit evidence/docs**

Stage only the convention/test evidence files that belong to this section. Do not commit downloaded MP4, generated WAV, `.data`, logs, browser profile, `.env` or credentials.

```powershell
git commit -m "test(audio): 验收三条代码音效交付链路"
```

## Self-review

- Spec coverage: no music, no new workflow node/queue/model, three workflow families, setting, idempotency, fallback, Artifact truth, UI and real media validation all have an owning task.
- Placeholder scan: no `TBD`, `TODO`, “similar to” or unspecified error-handling step remains.
- Type consistency: all tasks use the same `SoundEffectMode`, `ProceduralSfxStatus`, generator version, `cuePlanHash`, `timingHash` and `finalContentHash`.
- Safety:存量默认 off；SFX catch 只包增强分支；Artifact 不原地修改；download 与 UI 依赖实际 hash；音乐接口保持未实现。
