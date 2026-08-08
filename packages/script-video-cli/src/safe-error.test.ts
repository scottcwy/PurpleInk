import { describe, expect, it } from 'vitest'

import { AiProviderError, type AiProviderErrorCode } from './ai/openai-compatible'
import { projectSafeError } from './safe-error'

describe('projectSafeError AI provider mapping', () => {
  it.each([
    ['AI_CONFIG_INVALID', 'AI provider 配置无效。', false],
    ['AI_TIMEOUT', 'AI provider 请求超时。', true],
    ['AI_RATE_LIMITED', 'AI provider 请求受限。', true],
    ['AI_PROVIDER_UNAVAILABLE', 'AI provider 暂时不可用。', true],
    ['AI_OUTPUT_INVALID', 'AI provider 返回内容无效。', false],
  ] as const)('maps %s to a fixed safe projection', (code, message, retryable) => {
    const originalDetail = 'private upstream message and payload'
    const error = new AiProviderError(code as AiProviderErrorCode, originalDetail, {
      cause: new Error('private cause detail'),
    })

    const projected = projectSafeError(error)

    expect(projected).toEqual({ code, message, retryable })
    expect(JSON.stringify(projected)).not.toContain('private')
  })
})
