import { describe, expect, it, vi } from 'vitest'
import type {
  OpenAiCompatibleAsrProfile,
  OpenAiCompatibleTtsProfile,
} from '@/features/ai/openai-compatible-payloads'
import {
  readVerbose,
  synthesizeOpenAiCompatibleSpeech,
  transcribeOpenAiCompatibleSpeech,
  transcriptionForm,
} from './openai-compatible-audio-client'

vi.mock('server-only', () => ({}))

const TTS_PROFILE: OpenAiCompatibleTtsProfile = {
  baseUrl: 'https://example.test/v1',
  model: 'tts-1',
  voice: 'alloy',
  audioFormat: 'wav',
}

const ASR_PROFILE: OpenAiCompatibleAsrProfile = {
  baseUrl: 'https://example.test/v1',
  model: 'whisper-1',
  timestampMode: 'segment',
  verification: 'transcription',
}

describe('OpenAI-compatible TTS', () => {
  it('posts the official speech shape and returns the raw bytes', async () => {
    const fetcher = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
    )

    const result = await synthesizeOpenAiCompatibleSpeech(
      { text: '你好' },
      harnessTts(fetcher),
    )

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
    )
    const body = JSON.parse(String(callInit(fetcher).body)) as Record<string, unknown>
    expect(body).toEqual({
      model: 'tts-1',
      input: '你好',
      voice: 'alloy',
      response_format: 'wav',
    })
    expect(result.audioBytes).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(result.audioFormat).toBe('wav')
    expect(result.model).toBe('tts-1')
    // 该协议不返回时长与原生字幕，时长由 measureAudio 实测，不在此估算。
    expect(result.durationMs).toBe(0)
    expect(result.nativeCaptions).toEqual([])
  })

  it('prefers an explicit voice over the profile default', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 }))
    await synthesizeOpenAiCompatibleSpeech(
      { text: 'hi', voiceId: 'verse' },
      harnessTts(fetcher),
    )
    const body = JSON.parse(String(callInit(fetcher).body)) as { voice: string }
    expect(body.voice).toBe('verse')
  })

  it('fails loudly on an empty body instead of writing a zero-byte artifact', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(), { status: 200 }))
    await expect(
      synthesizeOpenAiCompatibleSpeech({ text: 'hi' }, harnessTts(fetcher)),
    ).rejects.toThrow('未返回音频字节')
  })

  it('refuses to run without a profile or a key', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }))
    await expect(synthesizeOpenAiCompatibleSpeech({ text: 'hi' }, {
      fetcher,
      getProfile: async () => null,
      getApiKey: async () => 'secret',
    })).rejects.toThrow('尚未配置')
    await expect(synthesizeOpenAiCompatibleSpeech({ text: 'hi' }, {
      fetcher,
      getProfile: async () => TTS_PROFILE,
      getApiKey: async () => null,
    })).rejects.toThrow('API Key')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('OpenAI-compatible ASR', () => {
  it('uploads multipart audio and converts second-based segments to millisecond captions', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      text: '你好世界',
      segments: [
        { text: '你好', start: 0, end: 0.42 },
        { text: '世界', start: 0.42, end: 1.2505 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await transcribeOpenAiCompatibleSpeech(
      { audioBytes: Buffer.from([1, 2, 3]), audioFormat: 'wav' },
      harnessAsr(fetcher),
    )

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    )
    const init = callInit(fetcher)
    expect(init.body).toBeInstanceOf(FormData)
    // boundary 必须由 FormData 生成，显式设置 content-type 会让请求体无法解析。
    expect(init.headers).toEqual({ authorization: 'Bearer secret' })
    expect(result).toEqual({
      transcript: '你好世界',
      model: 'whisper-1',
      timestampMode: 'segment',
      captions: [
        { text: '你好', startMs: 0, endMs: 420 },
        { text: '世界', startMs: 420, endMs: 1251 },
      ],
    })
  })

  it('reads the plain json shape when the endpoint has no timestamp support', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ text: '整段文本' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    const result = await transcribeOpenAiCompatibleSpeech(
      { audioBytes: Buffer.from([1]), audioFormat: 'mp3' },
      harnessAsr(fetcher, { ...ASR_PROFILE, timestampMode: 'none' }),
    )

    expect(result.captions).toEqual([])
    expect(result.timestampMode).toBe('none')
    expect(result.transcript).toBe('整段文本')
  })

  it('preserves the HTTP status without exposing the response body', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 413 }))
    await expect(transcribeOpenAiCompatibleSpeech(
      { audioBytes: Buffer.from([1]), audioFormat: 'wav' },
      harnessAsr(fetcher),
    )).rejects.toMatchObject({
      name: 'ProviderRequestError',
      httpStatus: 413,
      kind: 'request',
      funding: 'byok',
    })
  })

  it('maps a provider timeout to an explicit message', async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    })
    await expect(transcribeOpenAiCompatibleSpeech(
      { audioBytes: Buffer.from([1]), audioFormat: 'wav' },
      harnessAsr(fetcher),
    )).rejects.toThrow('请求超时')
  })
})

describe('transcription request shape', () => {
  it('asks for verbose_json plus segment granularity only in segment mode', () => {
    const segment = transcriptionForm(Buffer.from([1]), 'wav', 'whisper-1', 'segment')
    expect(segment.get('response_format')).toBe('verbose_json')
    expect(segment.get('timestamp_granularities[]')).toBe('segment')
    expect(segment.get('model')).toBe('whisper-1')

    const plain = transcriptionForm(Buffer.from([1]), 'mp3', 'gpt-4o-transcribe', 'none')
    expect(plain.get('response_format')).toBe('json')
    expect(plain.get('timestamp_granularities[]')).toBeNull()
  })

  it('drops empty and zero-length segments instead of emitting empty captions', () => {
    expect(readVerbose({
      text: 'ok',
      segments: [
        { text: '  ', start: 0, end: 1 },
        { text: 'kept', start: 1, end: 2 },
        { text: 'zero', start: 2, end: 2 },
      ],
    })).toEqual({
      transcript: 'ok',
      captions: [{ text: 'kept', startMs: 1000, endMs: 2000 }],
    })
  })
})

function callInit(fetcher: { mock: { calls: unknown[][] } }): RequestInit {
  return fetcher.mock.calls[0]?.[1] as RequestInit
}

function harnessTts(fetcher: unknown) {
  return {
    fetcher: fetcher as typeof fetch,
    getProfile: async () => TTS_PROFILE,
    getApiKey: async () => 'secret',
  }
}

function harnessAsr(fetcher: unknown, profile = ASR_PROFILE) {
  return {
    fetcher: fetcher as typeof fetch,
    getProfile: async () => profile,
    getApiKey: async () => 'secret',
  }
}
