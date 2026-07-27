import { describe, expect, it } from 'vitest'
import {
  parseAsrProfilePayload,
  parseOpenAiCompatibleProfilePayload,
  parseTtsProfilePayload,
} from './openai-compatible-payloads'

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

describe('OpenAI-compatible TTS profile payload', () => {
  it('requires endpoint, model, voice and a supported container', () => {
    expect(parseTtsProfilePayload({
      schemaVersion: 1,
      baseUrl: 'https://example.test/v1/',
      model: 'tts-model',
      voice: 'alloy',
      audioFormat: 'wav',
    })).toEqual({
      baseUrl: 'https://example.test/v1',
      model: 'tts-model',
      voice: 'alloy',
      audioFormat: 'wav',
    })
  })

  /**
   * 容器格式只开放 mp3 / wav：`measureAudio` 只识别 MP3 帧头与 WAV fmt chunk，
   * 而实测时长是 FABRICATE 帧数的唯一依据。
   */
  it('rejects containers the local duration measurement cannot read', () => {
    expect(parseTtsProfilePayload({
      schemaVersion: 1,
      baseUrl: 'https://example.test/v1',
      model: 'tts-model',
      voice: 'alloy',
      audioFormat: 'opus',
    })).toBeNull()
  })

  it('rejects a record without a voice', () => {
    expect(parseTtsProfilePayload({
      schemaVersion: 1,
      baseUrl: 'https://example.test/v1',
      model: 'tts-model',
      audioFormat: 'mp3',
    })).toBeNull()
  })
})

describe('OpenAI-compatible ASR profile payload', () => {
  it('keeps a negotiated segment timestamp mode', () => {
    expect(parseAsrProfilePayload({
      schemaVersion: 1,
      baseUrl: 'https://example.test/v1',
      model: 'asr-model',
      timestampMode: 'segment',
      verification: 'transcription',
    })).toEqual({
      baseUrl: 'https://example.test/v1',
      model: 'asr-model',
      timestampMode: 'segment',
      verification: 'transcription',
    })
  })

  /**
   * 记录不完整时必须保守收敛：凭一条缺失能力标记的记录去请求 verbose_json，
   * 会在每个字幕节点上换来一次必然失败的请求。
   */
  it('degrades an incomplete record to no timestamps and credential-only', () => {
    expect(parseAsrProfilePayload({
      schemaVersion: 1,
      baseUrl: 'https://example.test/v1',
      model: 'asr-model',
    })).toEqual({
      baseUrl: 'https://example.test/v1',
      model: 'asr-model',
      timestampMode: 'none',
      verification: 'credential-only',
    })
  })

  it('rejects records without an endpoint or model, and unknown versions', () => {
    expect(parseAsrProfilePayload({
      schemaVersion: 1,
      baseUrl: 'https://example.test/v1',
    })).toBeNull()
    expect(parseAsrProfilePayload({
      schemaVersion: 2,
      baseUrl: 'https://example.test/v1',
      model: 'asr-model',
    })).toBeNull()
  })
})
