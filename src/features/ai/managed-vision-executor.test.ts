import { describe, expect, it, vi } from 'vitest'
import { ManagedAiError } from './managed-service'
import {
  executeManagedVisionQa,
  VISION_QA_MAX_OUTPUT_TOKENS,
} from './managed-vision-executor'

vi.mock('server-only', () => ({}))

const target = {
  provider: 'gemini' as const,
  apiKey: 'route-key',
  baseUrl: 'https://example.invalid/v1',
  modelId: 'gemini-3.1-flash-lite',
  funding: 'managed' as const,
  deductsManagedPool: true,
}

describe('executeManagedVisionQa', () => {
  it('blocks an unauthorized managed route before creating transport', async () => {
    const complete = vi.fn()
    const begin = vi.fn(async () => {
      throw new ManagedAiError({
        code: 'MANAGED_GEMINI_FORBIDDEN_FOR_FREE',
        status: 403,
        retryable: false,
        message: 'Free 套餐不可使用 Gemini 托管服务',
      })
    })

    await expect(executeManagedVisionQa({
      attemptId: '00000000-0000-4000-8000-000000000001',
      invocationIndex: 1,
      prompt: 'check',
      images: [],
    }, {
      resolveTarget: async () => target,
      gateway: { begin },
      complete,
    })).rejects.toMatchObject({
      code: 'MANAGED_GEMINI_FORBIDDEN_FOR_FREE',
      status: 403,
    })
    expect(complete).not.toHaveBeenCalled()
  })

  it('reserves the actual multimodal request and settles reported usage', async () => {
    const settle = vi.fn(async () => undefined)
    const begin = vi.fn(async () => ({
      invocationId: 'vision',
      funding: 'managed' as const,
      deductsManagedPool: true,
      credential: 'managed-key',
      settle,
      settleUnavailable: vi.fn(async () => undefined),
      releaseBeforeCall: vi.fn(async () => undefined),
    }))
    const complete = vi.fn(async () => ({
      content: '{"summary":"ok"}',
      usage: { inputTokens: 30, cachedInputTokens: 4, outputTokens: 8 },
    }))

    await executeManagedVisionQa({
      attemptId: '00000000-0000-4000-8000-000000000001',
      invocationIndex: 1,
      prompt: 'check',
      images: [{ label: '25%', bytes: Buffer.from([1, 2, 3]) }],
    }, {
      resolveTarget: async () => target,
      gateway: { begin },
      complete,
    })

    expect(begin).toHaveBeenCalledWith(expect.objectContaining({
      invocationNo: 30_000,
      maxOutputTokens: VISION_QA_MAX_OUTPUT_TOKENS,
      rawInput: expect.stringContaining('data:image/png;base64,AQID'),
    }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'managed-key',
      maxOutputTokens: VISION_QA_MAX_OUTPUT_TOKENS,
    }))
    expect(settle).toHaveBeenCalledWith(
      {
        kind: 'text',
        inputTokens: 30,
        cachedInputTokens: 4,
        outputTokens: 8,
      },
      expect.stringMatching(/^[0-9a-f]{64}$/),
      false,
    )
  })
})
