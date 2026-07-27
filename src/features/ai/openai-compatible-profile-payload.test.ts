import { describe, expect, it, vi } from 'vitest'
import { parseOpenAiCompatibleProfilePayload } from './openai-compatible-profile-store'

vi.mock('server-only', () => ({}))

describe('OpenAI-compatible text profile payload', () => {
  it('reads v2 with an independent vision model', () => {
    expect(parseOpenAiCompatibleProfilePayload({
      schemaVersion: 2,
      baseUrl: 'https://example.test/v1/',
      textModel: 'text-model',
      visionModel: 'vision-model',
    })).toEqual({
      baseUrl: 'https://example.test/v1',
      textModel: 'text-model',
      visionModel: 'vision-model',
    })
  })

  it('treats a blank vision model as absent rather than empty string', () => {
    expect(parseOpenAiCompatibleProfilePayload({
      schemaVersion: 2,
      baseUrl: 'https://example.test/v1',
      textModel: 'text-model',
      visionModel: '   ',
    })).toEqual({
      baseUrl: 'https://example.test/v1',
      textModel: 'text-model',
      visionModel: null,
    })
  })

  /**
   * 回归护栏：v1 兼容读一旦丢失，已配置用户的文本端点会静默变成「未配置」，
   * 随后 customOpenAiDefaults 抛「尚未配置」，整条文本链路断掉且报错指向错误方向。
   */
  it('reads a v1 payload by mapping the legacy model to the text model only', () => {
    expect(parseOpenAiCompatibleProfilePayload({
      schemaVersion: 1,
      baseUrl: 'https://bcai.test/v1',
      defaultModel: 'legacy-model',
    })).toEqual({
      baseUrl: 'https://bcai.test/v1',
      textModel: 'legacy-model',
      // 该模型只被 chat/completions 校验过，从未证明能接受图像输入。
      visionModel: null,
    })
  })

  it('rejects unknown versions, bad URLs and missing models', () => {
    expect(parseOpenAiCompatibleProfilePayload({
      schemaVersion: 3,
      baseUrl: 'https://example.test/v1',
      textModel: 'text-model',
    })).toBeNull()
    expect(parseOpenAiCompatibleProfilePayload({
      schemaVersion: 2,
      baseUrl: 'ftp://example.test/v1',
      textModel: 'text-model',
    })).toBeNull()
    expect(parseOpenAiCompatibleProfilePayload({
      schemaVersion: 2,
      baseUrl: 'https://example.test/v1',
      textModel: '  ',
    })).toBeNull()
    expect(parseOpenAiCompatibleProfilePayload(null)).toBeNull()
    expect(parseOpenAiCompatibleProfilePayload([])).toBeNull()
  })
})
