import { describe, expect, it } from 'vitest'
import {
  MANAGED_MODEL_CATALOG,
  ManagedAiError,
  authorizeManagedRoute,
  filterAuthorizedFallbacks,
  managedCredentialUnavailableError,
  managedUpstreamError,
  type ManagedUsage,
} from './managed-service'

describe('managed model authorization', () => {
  it('keeps the managed catalog explicit and capability-bound', () => {
    expect(MANAGED_MODEL_CATALOG).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'stepfun',
        modelId: 'step-3.5-flash',
        capabilities: ['text'],
      }),
      expect.objectContaining({
        provider: 'mimo',
        modelId: 'mimo-v2.5-tts',
        capabilities: ['tts'],
      }),
      expect.objectContaining({
        provider: 'gemini',
        modelId: 'gemini-3.1-flash-lite',
        capabilities: ['text', 'vision'],
      }),
    ]))
  })

  it('rejects Gemini for Free with a stable 403 code', () => {
    expect(() => authorizeManagedRoute({
      plan: 'free',
      provider: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      capability: 'text',
    })).toThrow(expect.objectContaining({
      name: 'ManagedAiError',
      code: 'MANAGED_GEMINI_FORBIDDEN_FOR_FREE',
      status: 403,
      retryable: false,
    }))
  })

  it('authorizes managed models for eligible plans and charges the pool', () => {
    expect(authorizeManagedRoute({
      plan: 'plus',
      provider: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      capability: 'text',
    })).toEqual({
      funding: 'managed',
      deductsManagedPool: true,
    })
    expect(authorizeManagedRoute({
      plan: 'plus',
      provider: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      capability: 'vision',
    })).toEqual({
      funding: 'managed',
      deductsManagedPool: true,
    })
  })

  it('rejects unpriced legacy Gemini models from managed execution', () => {
    expect(() => authorizeManagedRoute({
      plan: 'plus',
      provider: 'gemini',
      modelId: 'gemini-3.6-flash',
      capability: 'vision',
    })).toThrow(expect.objectContaining({
      code: 'MANAGED_MODEL_NOT_AUTHORIZED',
      status: 403,
    }))
  })

  it('keeps custom OpenAI-compatible routes as BYOK without pool deduction', () => {
    expect(authorizeManagedRoute({
      plan: 'free',
      provider: 'openai-compatible',
      modelId: 'customer-selected-model',
      capability: 'text',
    })).toEqual({
      funding: 'byok',
      deductsManagedPool: false,
    })
  })

  it('filters fallback candidates by plan, capability, and funding mode', () => {
    expect(filterAuthorizedFallbacks({
      plan: 'free',
      capability: 'text',
      candidates: [
        'gemini',
        'stepfun',
        'openai-compatible',
        'openai-compatible-tts',
      ],
    })).toEqual(['stepfun', 'openai-compatible'])
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
