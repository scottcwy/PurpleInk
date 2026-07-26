# MiMo Provider and Media Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MiMo 接为第四个一等供应商，重构能力感知的设置页，并让 TTS/ASR 失败不再阻断文本工作流。

**Architecture:** 用一个 provider capability registry 统一 API、运行时和 UI 的供应商约束；MiMo 文本、TTS、ASR 都走官方 Chat Completions 协议。INGEST 先提交文本，随后把真实旁白合成作为同一现有队列中的独立 `media-narration` 作业；前置文本阶段允许继续，FABRICATE 在真实音频就绪前等待。

**Tech Stack:** Next.js 16、React、TypeScript strict、Zod、Postgres/Drizzle、现有 InProcessQueue、Vitest、Playwright。

---

### Task 1: 供应商能力注册表

**Files:**
- Create: `src/features/ai/provider-registry.ts`
- Create: `src/features/ai/provider-registry.test.ts`
- Modify: `src/features/ai/model-routing.ts`
- Modify: `src/features/ai/schemas.ts`
- Modify: `src/features/ai/index.ts`

- [ ] **Step 1: 写失败测试**

```ts
expect(providerSupports('mimo', 'tts')).toBe(true)
expect(providerSupports('gemini', 'tts')).toBe(false)
expect(providersFor('asr')).toEqual(['stepfun', 'mimo'])
expect(() => assertProviderCapability('openai-compatible', 'tts')).toThrow()
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/features/ai/provider-registry.test.ts src/features/ai/model-routing.test.ts`
Expected: FAIL，当前不存在 `mimo` 和能力注册表。

- [ ] **Step 3: 实现单一注册表**

```ts
export type ProviderCapability = 'text' | 'vision' | 'tts' | 'asr'
export const AI_PROVIDER_IDS = ['gemini', 'stepfun', 'mimo', 'openai-compatible'] as const
export const PROVIDERS = {
  gemini: { capabilities: ['text', 'vision'] },
  stepfun: { capabilities: ['text', 'vision', 'tts', 'asr'] },
  mimo: { capabilities: ['text', 'vision', 'tts', 'asr'] },
  'openai-compatible': { capabilities: ['text', 'vision'] },
} as const
```

让 `saveDirectorRoutes` 同时保存 AI 与 media route，并在服务端按节点能力校验。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `pnpm exec vitest run src/features/ai/provider-registry.test.ts src/features/ai/model-routing.test.ts`
Commit: `feat(ai): 建立能力感知的供应商注册表`

### Task 2: MiMo 配置、凭据与文本运行时

**Files:**
- Create: `src/features/ai/mimo-config.ts`
- Create: `src/features/ai/mimo-config.test.ts`
- Create: `src/features/ai/mimo-adapter.ts`
- Create: `src/features/ai/mimo-adapter.test.ts`
- Modify: `src/features/ai/config.ts`
- Modify: `src/features/director/pi-provider.ts`
- Modify: `src/features/director/pi-provider.test.ts`
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/app/api/settings/route.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: 写凭据和路由 RED**

```ts
expect(validateMimoCredentialFormat('tp-secret')).toEqual({
  ok: false,
  reason: 'token-plan-not-for-backend',
})
expect(await resolveDirectorModelTarget('shot-codegen', 'text', deps))
  .toMatchObject({ provider: 'mimo', modelId: 'mimo-v2.5' })
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/features/ai/mimo-config.test.ts src/features/ai/mimo-adapter.test.ts src/features/director/pi-provider.test.ts src/app/api/settings/route.test.ts`
Expected: FAIL，MiMo 配置与 API 分支尚不存在。

- [ ] **Step 3: 实现配置和安全校验**

默认端点为 `https://api.xiaomimimo.com/v1`；默认 text/vision/TTS/ASR 分别为
`mimo-v2.5`、`mimo-v2.5`、`mimo-v2.5-tts`、`mimo-v2.5-asr`。
Key 保存前先拒绝 `tp-`，再用 `POST /chat/completions` 的最小推理验证；响应与日志不含 Key。
`.env.example` 只增加非敏感 `MIMO_*` 默认项，不增加 Key。

- [ ] **Step 4: 接入 Pi runtime**

`pi-provider.ts` 对 MiMo 使用 `openai-completions`，保留独立 `provider: 'mimo'`
和 route label，不复用 `openai-compatible` 的用户 profile。

- [ ] **Step 5: 运行 GREEN 并提交**

Run: `pnpm exec vitest run src/features/ai/mimo-config.test.ts src/features/ai/mimo-adapter.test.ts src/features/director/pi-provider.test.ts src/app/api/settings/route.test.ts`
Commit: `feat(ai): 接入 MiMo 配置与文本模型`

### Task 3: MiMo TTS/ASR 客户端与媒体路由

**Files:**
- Create: `src/features/audio/mimo-audio-client.ts`
- Create: `src/features/audio/mimo-audio-client.test.ts`
- Create: `src/features/audio/media-provider.ts`
- Create: `src/features/audio/media-provider.test.ts`
- Modify: `src/features/audio/narration.ts`
- Modify: `src/features/audio/narration.test.ts`
- Modify: `src/features/audio/subtitle.ts`
- Modify: `src/features/audio/subtitle.test.ts`
- Modify: `src/features/audio/types.ts`

- [ ] **Step 1: 写官方协议 RED**

```ts
expect(ttsRequest.messages.at(-1)).toEqual({ role: 'assistant', content: '旁白' })
expect(ttsRequest.audio).toEqual({ format: 'wav', voice: 'mimo_default' })
expect(asrRequest.messages[0].content[0].type).toBe('input_audio')
expect(asrRequest.asr_options).toEqual({ language: 'auto' })
```

- [ ] **Step 2: 实现客户端和 provider dispatcher**

TTS 解码 `choices[0].message.audio.data`；ASR 读取 `message.content`。
`resolveMediaProvider('tts' | 'asr')` 从 `media_routes` 加载供应商、模型和加密凭据，
再分派到 StepFun 或 MiMo。MiMo ASR 返回 `alignmentSource: 'mimo-asr'`，
不伪造词级 timestamps。

- [ ] **Step 3: 运行 GREEN 并提交**

Run: `pnpm exec vitest run src/features/audio/mimo-audio-client.test.ts src/features/audio/media-provider.test.ts src/features/audio/narration.test.ts src/features/audio/subtitle.test.ts`
Commit: `feat(audio): 支持 MiMo TTS 与 ASR 路由`

### Task 4: INGEST 与旁白任务解耦

**Files:**
- Create: `src/features/audio/narration-queue-handler.ts`
- Create: `src/features/audio/narration-queue-handler.test.ts`
- Create: `src/features/director/media-readiness.ts`
- Create: `src/features/director/media-readiness.test.ts`
- Modify: `src/lib/queue/init.ts`
- Modify: `src/features/director/stage-result.ts`
- Modify: `src/features/director/stage-result.test.ts`
- Modify: `src/features/director/stage-runner.ts`
- Modify: `src/features/director/runtime-artifact-source.ts`
- Modify: `src/features/director/runtime-artifact-reader.ts`
- Modify: `src/features/director/prompts/direct.ts`
- Modify: `src/features/director/prompts/shot-spec.ts`
- Modify: `src/features/director/advance.ts`

- [ ] **Step 1: 写容灾 RED**

```ts
expect(JSON.parse(ingest.content)).toEqual({ scriptUnits })
expect(enqueueNarration).toHaveBeenCalledOnce()
expect(directResult.status).toBe('success')
expect(fabricateReadiness).toEqual({ ready: false, reason: 'waiting-media' })
```

另加负向测试：narration 作业失败只记录媒体错误，不把 INGEST 从 success 改成 failed；
相同项目已有 pending/running narration 时拒绝重复入队。

- [ ] **Step 2: 先提交文本，再排媒体任务**

`prepareStageResult(INGEST)` 不再调用 TTS。INGEST artifact 只含 `scriptUnits`；
commit 后 `stage-runner` 调用 `enqueueNarration({projectId,nodeId})`。
`media-narration` handler 从可信 INGEST artifact 加载 scriptUnits，执行真实 TTS，
提交独立 `director-ingest-audio` JSON artifact 与 `narration-audio:*` 字节产物。

- [ ] **Step 3: 放宽前置 prompt，门禁 FABRICATE**

DIRECT/SHOT_SPEC 的输入 schema 将音频字段改为可选，并在 prompt 中明确“音频待生成”。
FABRICATE 加载不到 `director-ingest-audio` 时不领取模型任务；推进服务把节点保持
`idle` 并投影 `waiting-media`。媒体成功后调用统一 `advancePipeline` 唤醒。

- [ ] **Step 4: 运行 GREEN 与 PG 回归并提交**

Run: `pnpm exec vitest run src/features/director/stage-result.test.ts src/features/audio/narration-queue-handler.test.ts src/features/director/media-readiness.test.ts src/features/director/stage-runner.test.ts`
Run: `pnpm test:pg`
Commit: `fix(workflow): 解耦文本摄取与旁白生成`

### Task 5: 设置页重构

**Files:**
- Create: `src/app/products/(app)/settings/provider-registry-panel.tsx`
- Create: `src/app/products/(app)/settings/provider-detail-panel.tsx`
- Create: `src/app/products/(app)/settings/workflow-route-matrix.tsx`
- Modify: `src/app/products/(app)/settings/model-service-contract.ts`
- Modify: `src/app/products/(app)/settings/model-service-settings.tsx`
- Modify: `src/app/products/(app)/settings/model-service-panels.tsx`
- Delete: `src/app/products/(app)/settings/custom-openai-provider-panel.tsx`
- Modify: `tests/products-settings-layout.test.ts`

- [ ] **Step 1: 写 UI 结构 RED**

断言四个供应商、能力标签、连接状态、详情编辑区和三组路由存在；断言 TTS/ASR
下拉不含 Gemini 和 custom，pending 保存按钮禁用，错误文案不含原始 provider 响应。

- [ ] **Step 2: 复用现有设计系统实现三层界面**

供应商卡只负责选择；详情面板负责当前供应商连接与模型；路由矩阵按能力过滤选项。
每个保存区独立 loading/toast，GET/POST 契约仍复用 `/api/settings`。

- [ ] **Step 3: 运行 GREEN、Chromium 验收并提交**

Run: `pnpm exec vitest run tests/products-settings-layout.test.ts src/app/api/settings/route.test.ts`
Browser: 打开 `/products/settings`，切换四个供应商，检查控制台为零错误。
Commit: `feat(settings): 重构能力感知的模型服务配置`

### Task 6: 文档、真实运行与最终门禁

**Files:**
- Modify: `docs/conventions/routing.md`
- Modify: `docs/configuration/credentials.md`
- Modify: `docs/configuration/tts.md`

- [ ] **Step 1: 更新真实契约**

记录四供应商、MiMo 产品 API 凭据限制、媒体异步状态、TTS/ASR 能力验证与恢复语义。

- [ ] **Step 2: 配置本地非敏感默认值并重启**

`.env.local` 只写 `MIMO_BASE_URL` 与四个默认模型；不写或复制 Token Plan Key。
重启 Next 与 worker，确认加载新 handler。若提供合法 `sk-` Key，执行真实 text →
TTS → ASR；否则把真实 MiMo 探测标记为“缺少合规产品 API Key，未执行”。

- [ ] **Step 3: 全链路验证**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Run: `pnpm test:pg`
Run: `pnpm verify:v3`
Run: `pnpm build`
Run: `git diff --check`
Run: `rg -n \"�\" AGENTS.md README.md docs src server scripts`

- [ ] **Step 4: 真实浏览器与媒体证据**

新建双镜头项目，证明文本阶段在媒体失败时继续，媒体恢复后 FABRICATE 自动推进；
对最终音频/视频执行 `ffprobe` 和 SHA-256，并验证下载 HTTP。

- [ ] **Step 5: 提交文档**

Commit: `docs(workflow): 更新 MiMo 与媒体恢复契约`
