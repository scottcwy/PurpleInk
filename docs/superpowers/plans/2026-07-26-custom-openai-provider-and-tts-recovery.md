# Custom OpenAI Provider and TTS Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user configure one encrypted OpenAI-compatible text-model provider, select it per Director route and recover a configuration-blocked project after its settings are fixed.

**Architecture:** Keep text-model routing and media routing separate. A workspace-scoped `openai-compatible` profile stores only endpoint and default model in `workspace_settings`; its API key stays encrypted in `provider_credentials`. Existing `model_routes` continue to own the effective model per AI task, so the selected custom model is committed with the selected route. StepFun remains the only TTS/ASR provider unless a future media-provider capability is explicitly implemented.

**Tech Stack:** Next.js 16, TypeScript, Zod, Drizzle/Postgres, Pi AI OpenAI-completions adapter, Vitest, Playwright.

---

### Task 1: Establish the runtime and recovery contracts

**Files:**

- Create: `src/features/ai/openai-compatible-config.test.ts`
- Create: `src/features/director/recovery-config.test.ts`
- Modify: `src/features/director/recovery.ts`
- Modify: `src/app/products/(app)/canvas/[projectId]/node-action-presentation.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('persists a validated OpenAI-compatible profile without exposing its key', async () => {
  await saveOpenAiCompatibleProfile({
    apiKey: 'secret',
    baseUrl: 'https://example.test/v1',
    defaultModel: 'example-model',
  }, dependencies)
  expect(await describeOpenAiCompatibleProfile(dependencies)).toMatchObject({
    configured: true,
    baseUrl: { value: 'https://example.test/v1', source: 'settings' },
  })
})

it('allows one explicit retry after configuration has been repaired', async () => {
  await expect(resolveNodeAction(blockedConfigurationNode, 'repair', deps))
    .resolves.toMatchObject({ action: 'repair-upstream' })
})
```

- [ ] **Step 2: Run targeted tests and observe failure**

Run: `pnpm exec vitest run src/features/ai/openai-compatible-config.test.ts src/features/director/recovery-config.test.ts`

Expected: FAIL because the custom profile and configuration-repair behavior do not exist.

- [ ] **Step 3: Implement profile persistence and explicit-only configuration retry**

```ts
export const CUSTOM_OPENAI_PROVIDER = 'openai-compatible' as const

export async function saveOpenAiCompatibleProfile(input: OpenAiCompatibleProfileInput) {
  // validate endpoint/model, save encrypted key only after a real probe,
  // then atomically persist non-secret endpoint/default-model settings.
}
```

The recovery rule must remain bounded: automatic advance stays blocked, while a later user-triggered repair is permitted after settings are changed.

- [ ] **Step 4: Run targeted tests and commit**

Run: `pnpm exec vitest run src/features/ai/openai-compatible-config.test.ts src/features/director/recovery-config.test.ts`

Commit: `fix(workflow): 允许配置修复后的显式继续`

### Task 2: Extend the typed text-model routing boundary

**Files:**

- Modify: `src/features/ai/model-routing.ts`
- Modify: `src/features/director/pi-provider.ts`
- Modify: `src/features/ai/schemas.ts`
- Test: `src/features/ai/model-routing.test.ts`
- Test: `src/features/director/pi-provider.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('resolves a custom OpenAI-compatible route with its encrypted key and route model', async () => {
  await expect(resolveDirectorModelTarget('script-import', 'text', deps))
    .resolves.toMatchObject({
      provider: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      modelId: 'mimo-v2.5-pro',
      apiKey: 'secret',
    })
})
```

- [ ] **Step 2: Run the tests and observe failure**

Run: `pnpm exec vitest run src/features/ai/model-routing.test.ts src/features/director/pi-provider.test.ts`

- [ ] **Step 3: Implement the provider registry extension**

Accept `openai-compatible` for AI task routes only. Preserve the current StepFun-only TTS/ASR routes. The Pi runtime uses `openai-completions` for the custom provider and never converts its endpoint into Gemini's native endpoint.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm exec vitest run src/features/ai/model-routing.test.ts src/features/director/pi-provider.test.ts`

Commit: `feat(ai): 支持 OpenAI 兼容模型路由`

### Task 3: Expose safe settings and per-route model selection

**Files:**

- Modify: `src/app/api/settings/route.ts`
- Modify: `src/app/products/(app)/settings/model-service-contract.ts`
- Modify: `src/app/products/(app)/settings/model-service-panels.tsx`
- Modify: model-settings controller module discovered from the settings page
- Test: `src/app/api/settings/route.test.ts`
- Test: settings component/controller tests discovered from the current module

- [ ] **Step 1: Write failing API and UI contract tests**

```ts
expect(await postSettings({
  customOpenAi: {
    apiKey: 'candidate-key',
    baseUrl: 'https://example.test/v1',
    defaultModel: 'mimo-v2.5-pro',
  },
})).toMatchObject({ ok: true, customOpenAi: { configured: true } })
```

The tests must prove the JSON response never contains the submitted key and that a route can select `openai-compatible` with its own model ID.

- [ ] **Step 2: Run tests and observe failure**

Run: `pnpm exec vitest run src/app/api/settings/route.test.ts`

- [ ] **Step 3: Implement settings UI/API**

Add endpoint, default model and key fields under “OpenAI 兼容模型服务”. Add a provider option to eligible Director/Vision rows and a model field that is required for custom routes. Keep TTS/ASR visibly fixed to StepFun.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm exec vitest run src/app/api/settings/route.test.ts`

Commit: `feat(settings): 配置自定义 OpenAI 兼容模型`

### Task 4: Verify external providers and the new-project recovery flow

**Files:**

- Modify: `docs/configuration/ai-providers.md`
- Modify: `docs/conventions/routing.md` only if settings/API contract changes require routing documentation updates
- Test: end-to-end and regression tests created by prior tasks

- [ ] **Step 1: Verify the actual StepFun TTS failure path**

Use the loaded application runtime to perform one minimal, redacted TTS readiness probe. Record only status, provider error category and trace ID if provided; never persist or print the key.

- [ ] **Step 2: Configure and verify MiMo through the settings surface**

Use the user-supplied Token Plan key through the password field. Verify a minimal `mimo-v2.5-pro` completion succeeds and that the stored secret is encrypted and absent from API responses/logs.

- [ ] **Step 3: Exercise routing and recovery**

Select the custom provider for INGEST, create a project, confirm the text stage uses MiMo, and verify that a previously configuration-blocked node can be explicitly resumed after the relevant provider is repaired. TTS must either pass a real readiness probe or remain honestly blocked with its specific cause.

- [ ] **Step 4: Run final gates and commit docs**

Run: `pnpm lint`, `pnpm typecheck`, `pnpm test`, targeted `pnpm test:pg`, `pnpm verify:v3`, `pnpm build`, `git diff --check`, and the UTF-8 replacement-character scan.

Commit: `docs(ai): 规范自定义 OpenAI 兼容模型路由`
