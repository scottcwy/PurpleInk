import { describe, expect, it, vi } from 'vitest'

const { models, resolveDirectorModelTarget } = vi.hoisted(() => ({
  models: { setProvider: vi.fn() },
  resolveDirectorModelTarget: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@earendil-works/pi-ai', () => ({
  createModels: vi.fn(() => models),
  createProvider: vi.fn((provider) => provider),
  envApiKeyAuth: vi.fn(() => ({ type: 'env' })),
}))
vi.mock('@earendil-works/pi-ai/api/google-generative-ai.lazy', () => ({
  googleGenerativeAIApi: vi.fn(() => ({ type: 'google' })),
}))
vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: vi.fn(() => ({ type: 'openai' })),
}))
vi.mock('@/features/ai/model-routing', () => ({
  DIRECTOR_NODE_TYPES: ['script-import'],
  resolveDirectorModelTarget,
}))

import { createDirectorModelRuntime } from './pi-provider'

describe('createDirectorModelRuntime', () => {
  it('uses the OpenAI completions adapter for a custom compatible provider', async () => {
    resolveDirectorModelTarget.mockResolvedValueOnce({
      provider: 'openai-compatible',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/',
      modelId: 'mimo-v2.5-pro',
      apiKey: 'candidate-secret',
    })

    const runtime = await createDirectorModelRuntime({
      nodeType: 'script-import',
      stage: 'INGEST',
    })

    expect(runtime.model).toMatchObject({
      api: 'openai-completions',
      provider: 'openai-compatible',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      id: 'mimo-v2.5-pro',
    })
    expect(runtime.routeLabel).toBe('openai-compatible/mimo-v2.5-pro')
  })

  it('keeps MiMo independent while using its OpenAI-compatible transport', async () => {
    resolveDirectorModelTarget.mockResolvedValueOnce({
      provider: 'mimo',
      baseUrl: 'https://api.xiaomimimo.com/v1/',
      modelId: 'mimo-v2.5',
      apiKey: 'stored-product-secret',
    })

    const runtime = await createDirectorModelRuntime({
      nodeType: 'script-import',
      stage: 'INGEST',
    })

    expect(runtime.model).toMatchObject({
      api: 'openai-completions',
      provider: 'mimo',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      id: 'mimo-v2.5',
    })
    expect(runtime.routeLabel).toBe('mimo/mimo-v2.5')
  })
})
