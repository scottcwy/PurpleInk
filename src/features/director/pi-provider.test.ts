import { describe, expect, it, vi } from 'vitest'

const { models, resolveDirectorModelTarget } = vi.hoisted(() => ({
  models: { setProvider: vi.fn() },
  resolveDirectorModelTarget: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@earendil-works/pi-ai', () => ({
  createModels: vi.fn(() => models),
  createProvider: vi.fn((provider) => provider),
  envApiKeyAuth: vi.fn(() => ({
    resolve: async () => ({
      auth: { apiKey: 'legacy-env-key' },
      source: 'STEP_API_KEY',
    }),
  })),
}))
vi.mock('@earendil-works/pi-ai/api/anthropic-messages.lazy', () => ({
  anthropicMessagesApi: vi.fn(() => ({ type: 'anthropic' })),
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
    const provider = models.setProvider.mock.calls.at(-1)?.[0]
    const auth = await provider.auth.apiKey.resolve({
      ctx: { env: vi.fn() },
    })
    expect(auth).toEqual({
      auth: { apiKey: 'candidate-secret' },
      source: 'resolved route credential',
    })
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

  it('uses Anthropic Messages only for the official Anthropic BYOK deployment', async () => {
    resolveDirectorModelTarget.mockResolvedValueOnce({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1/',
      modelId: 'claude-sonnet-5',
      logicalModelId: 'claude-sonnet-5',
      deploymentId: 'anthropic.claude-sonnet-5.byok',
      providerPoolId: 'workspace-1:anthropic',
      adapterProtocol: 'anthropic-messages',
      apiKey: 'stored-anthropic-secret',
      funding: 'byok',
    })

    const runtime = await createDirectorModelRuntime({
      nodeType: 'script-import',
      stage: 'INGEST',
    })

    expect(runtime.model).toMatchObject({
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      id: 'claude-sonnet-5',
    })
    expect(runtime).toMatchObject({
      logicalModelId: 'claude-sonnet-5',
      deploymentId: 'anthropic.claude-sonnet-5.byok',
      providerPoolId: 'workspace-1:anthropic',
      funding: 'byok',
    })
  })
})
