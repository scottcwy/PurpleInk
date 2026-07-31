import { describe, expect, it, vi } from 'vitest'
import {
  ManagedAiError,
  authorizeManagedRoute,
  filterAuthorizedFallbacks,
  managedCredentialUnavailableError,
  managedUpstreamError,
  type ManagedUsage,
} from './managed-service'
import type {
  ManagedModelCatalogRepository,
  ManagedModelDefinition,
} from './managed-model-catalog-repository'

vi.mock('server-only', () => ({}))

const CATALOG: ManagedModelDefinition[] = [
  {
    id: 'step-text',
    provider: 'stepfun',
    modelId: 'step-3.7-flash',
    capabilities: ['text'],
    minimumPlanKey: 'free',
    enabled: true,
  },
  {
    id: 'mimo-tts',
    provider: 'mimo',
    modelId: 'mimo-v2.5-tts',
    capabilities: ['tts'],
    minimumPlanKey: 'free',
    enabled: true,
  },
  {
    id: 'gemini',
    provider: 'gemini',
    modelId: 'gemini-3.6-flash',
    capabilities: ['text', 'vision'],
    minimumPlanKey: 'plus',
    enabled: true,
  },
  {
    id: 'openai',
    provider: 'openai',
    modelId: 'gpt-5.6-luna',
    capabilities: ['text', 'vision'],
    minimumPlanKey: 'pro',
    enabled: true,
  },
  {
    id: 'anthropic',
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    capabilities: ['text', 'vision'],
    minimumPlanKey: 'pro',
    enabled: true,
  },
]

const catalog: ManagedModelCatalogRepository = {
  async find(input) {
    return CATALOG.find((model) =>
      model.provider === input.provider
      && model.modelId === input.modelId
      && model.capabilities.includes(input.capability)) ?? null
  },
  async listEnabled() {
    return CATALOG
  },
}

describe('managed model authorization', () => {
  it('allows Free to use a catalog Gemini model with BYOK', async () => {
    await expect(authorizeManagedRoute({
      plan: 'free',
      provider: 'gemini',
      modelId: 'gemini-3.6-flash',
      capability: 'text',
      funding: 'byok',
    }, catalog)).resolves.toMatchObject({
      funding: 'byok',
      deductsManagedPool: false,
    })
  })

  it('keeps the managed catalog explicit and capability-bound', async () => {
    await expect(catalog.listEnabled()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'stepfun',
        modelId: 'step-3.7-flash',
        capabilities: ['text'],
      }),
      expect.objectContaining({
        provider: 'mimo',
        modelId: 'mimo-v2.5-tts',
        capabilities: ['tts'],
      }),
      expect.objectContaining({
        provider: 'gemini',
        modelId: 'gemini-3.6-flash',
        capabilities: ['text', 'vision'],
      }),
    ]))
  })

  it('rejects Gemini for Free with a stable 403 code', async () => {
    await expect(authorizeManagedRoute({
      plan: 'free',
      provider: 'gemini',
      modelId: 'gemini-3.6-flash',
      capability: 'text',
    }, catalog)).rejects.toMatchObject({
      name: 'ManagedAiError',
      code: 'MANAGED_GEMINI_FORBIDDEN_FOR_FREE',
      status: 403,
      retryable: false,
    })
  })

  it('authorizes managed models for eligible plans and charges the pool', async () => {
    await expect(authorizeManagedRoute({
      plan: 'plus',
      provider: 'gemini',
      modelId: 'gemini-3.6-flash',
      capability: 'text',
    }, catalog)).resolves.toEqual({
      funding: 'managed',
      deductsManagedPool: true,
      catalogId: 'gemini',
    })
    await expect(authorizeManagedRoute({
      plan: 'plus',
      provider: 'gemini',
      modelId: 'gemini-3.6-flash',
      capability: 'vision',
    }, catalog)).resolves.toEqual({
      funding: 'managed',
      deductsManagedPool: true,
      catalogId: 'gemini',
    })
  })

  it('rejects unpriced legacy Gemini models from managed execution', async () => {
    await expect(authorizeManagedRoute({
      plan: 'plus',
      provider: 'gemini',
      modelId: 'gemini-legacy',
      capability: 'vision',
    }, catalog)).rejects.toMatchObject({
      code: 'MANAGED_MODEL_NOT_AUTHORIZED',
      status: 403,
    })
  })

  it('keeps custom OpenAI-compatible routes as BYOK without pool deduction', async () => {
    await expect(authorizeManagedRoute({
      plan: 'free',
      provider: 'openai-compatible',
      modelId: 'customer-selected-model',
      capability: 'text',
    }, catalog)).resolves.toEqual({
      funding: 'byok',
      deductsManagedPool: false,
    })
  })

  it('allows all built-in vendors with BYOK but gates managed OpenAI to Pro', async () => {
    await expect(authorizeManagedRoute({
      plan: 'free',
      provider: 'openai',
      modelId: 'gpt-5.6-luna',
      capability: 'text',
      funding: 'byok',
    }, catalog)).resolves.toMatchObject({
      funding: 'byok',
      deductsManagedPool: false,
    })
    await expect(authorizeManagedRoute({
      plan: 'plus',
      provider: 'openai',
      modelId: 'gpt-5.6-luna',
      capability: 'text',
      funding: 'managed',
    }, catalog)).rejects.toMatchObject({
      code: 'MANAGED_MODEL_NOT_AUTHORIZED',
    })
    await expect(authorizeManagedRoute({
      plan: 'pro',
      provider: 'anthropic',
      modelId: 'claude-sonnet-5',
      capability: 'vision',
      funding: 'managed',
    }, catalog)).resolves.toMatchObject({
      funding: 'managed',
      deductsManagedPool: true,
    })
  })

  it('filters fallback candidates by plan, capability, and funding mode', async () => {
    await expect(filterAuthorizedFallbacks({
      plan: 'free',
      capability: 'text',
      candidates: [
        'gemini',
        'stepfun',
        'openai-compatible',
        'openai-compatible-tts',
      ],
    }, catalog)).resolves.toEqual(['stepfun', 'openai-compatible'])
  })
})

describe('managed usage and errors', () => {
  it('represents non-text usage in native units', () => {
    const usage = [
      { kind: 'text', inputTokens: 12, outputTokens: 4 },
      { kind: 'tts', inputCharacters: 80, outputAudioSeconds: 6.5 },
      { kind: 'asr', inputAudioSeconds: 30 },
      { kind: 'image', operation: 'generate', outputImages: 1, width: 1024, height: 1024 },
      { kind: 'video', operation: 'render', outputSeconds: 8, width: 1920, height: 1080 },
      { kind: 'tool', tool: 'web-search', calls: 2 },
    ] satisfies ManagedUsage[]

    expect(usage.map((item) => item.kind)).toEqual([
      'text',
      'tts',
      'asr',
      'image',
      'video',
      'tool',
    ])
  })

  it('projects upstream failures to a stable sanitized error', () => {
    const error = managedUpstreamError(
      new Error('credential=super-secret provider raw response'),
    )

    expect(error).toBeInstanceOf(ManagedAiError)
    expect(error).toMatchObject({
      code: 'MANAGED_UPSTREAM_FAILED',
      status: 502,
      retryable: true,
      message: '托管 AI 服务本次执行失败，请稍后重试',
    })
    expect(JSON.stringify(error)).not.toContain('super-secret')
    expect(JSON.stringify(error)).not.toContain('provider raw response')
  })

  it('marks an absent managed credential as a non-retryable configuration block', () => {
    const error = managedCredentialUnavailableError()

    expect(error).toMatchObject({
      code: 'MANAGED_CREDENTIAL_UNAVAILABLE',
      status: 503,
      retryable: false,
      message: '托管 AI 服务凭据未配置，请联系管理员完成服务配置。',
    })
  })
})
