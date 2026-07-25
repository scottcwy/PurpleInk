import { describe, expect, it, vi } from 'vitest'
import type { StepfunConfig } from '@/features/ai/config'
import {
  synthesizeSpeech,
  transcribeSpeech,
  type StepfunAudioDependencies,
} from './stepfun-audio-client'

vi.mock('server-only', () => ({}))

const config: StepfunConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://api.stepfun.test/v1',
  chatModel: 'step-chat',
  ttsModel: 'stepaudio-2.5-tts',
  asrModel: 'stepaudio-2.5-asr',
  visionModel: 'step-vision',
}

function dependencies(fetcher: typeof fetch): StepfunAudioDependencies {
  return {
    fetcher,
    getConfig: async () => config,
  }
}

describe('synthesizeSpeech', () => {
  it('requests StepFun TTS with native timestamps and downloads the returned audio', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          created: 123,
          data: {
            url: 'https://audio.stepfun.test/voice.mp3',
            subtitles: [
              {
                text: '你好世界',
                request_id: 'request-1',
                timestamp: 123_000,
                items: [
                  { text: '你好', start_time: 0, end_time: 320 },
                  { text: '世界', start_time: 320, end_time: 760 },
                ],
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
        })
      )

    const result = await synthesizeSpeech(
      {
        text: '你好世界',
        voiceId: 'cixingnansheng',
      },
      dependencies(fetcher)
    )

    const request = fetcher.mock.calls[0]
    expect(request?.[0]).toBe('https://api.stepfun.test/v1/audio/speech')
    expect(request?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
      }),
    })
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      model: 'stepaudio-2.5-tts',
      voice: 'cixingnansheng',
      input: '你好世界',
      response_format: 'mp3',
      return_url: true,
      timestamp: true,
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://audio.stepfun.test/voice.mp3')
    expect(result).toEqual({
      audioBytes: Buffer.from([1, 2, 3]),
      audioFormat: 'mp3',
      durationMs: 760,
      model: 'stepaudio-2.5-tts',
      nativeCaptions: [
        { text: '你好', startMs: 0, endMs: 320 },
        { text: '世界', startMs: 320, endMs: 760 },
      ],
    })
  })

  it('fails before making a request when no StepFun key is configured', async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(
      synthesizeSpeech(
        { text: '你好' },
        {
          fetcher,
          getConfig: async () => ({ ...config, apiKey: null }),
        }
      )
    ).rejects.toThrow('StepFun API Key')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a TTS response without usable native timestamps', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: {
          url: 'https://audio.stepfun.test/voice.mp3',
          subtitles: [{ text: '你好', request_id: 'request-1', items: [] }],
        },
      })
    )

    await expect(
      synthesizeSpeech({ text: '你好' }, dependencies(fetcher))
    ).rejects.toThrow('词级时间戳')
  })
})

describe('transcribeSpeech', () => {
  it('parses timestamped ASR deltas and the authoritative done transcript', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        [
          'data: {"type":"transcript.text.delta","delta":"你好","start_time":0,"end_time":320}',
          'data: {"type":"transcript.text.delta","delta":"世界","start_time":320,"end_time":760}',
          'data: {"type":"transcript.text.done","text":"你好世界"}',
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    )

    const result = await transcribeSpeech(
      {
        audioBytes: Buffer.from([1, 2, 3]),
        audioFormat: 'mp3',
      },
      dependencies(fetcher)
    )

    const request = fetcher.mock.calls[0]
    expect(request?.[0]).toBe('https://api.stepfun.test/v1/audio/asr/sse')
    expect(request?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        accept: 'text/event-stream',
        authorization: 'Bearer test-key',
      }),
    })
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      audio: {
        data: Buffer.from([1, 2, 3]).toString('base64'),
        input: {
          transcription: {
            language: 'zh',
            model: 'stepaudio-2.5-asr',
            enable_itn: true,
            enable_timestamp: true,
          },
          format: { type: 'mp3' },
        },
      },
    })
    expect(result).toEqual({
      transcript: '你好世界',
      model: 'stepaudio-2.5-asr',
      captions: [
        { text: '你好', startMs: 0, endMs: 320 },
        { text: '世界', startMs: 320, endMs: 760 },
      ],
    })
  })

  it('surfaces a provider error event instead of returning partial text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        'data: {"type":"transcript.text.delta","delta":"半"}\n\n' +
          'data: {"type":"error","message":"音频格式不支持"}\n\n'
      )
    )

    await expect(
      transcribeSpeech(
        { audioBytes: Buffer.from([1]), audioFormat: 'mp3' },
        dependencies(fetcher)
      )
    ).rejects.toThrow('音频格式不支持')
  })

  it('rejects malformed SSE JSON and a missing done event', async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('data: {not-json}\n\n')
    )
    await expect(
      transcribeSpeech(
        { audioBytes: Buffer.from([1]), audioFormat: 'mp3' },
        dependencies(malformed)
      )
    ).rejects.toThrow('ASR SSE')

    const missingDone = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        'data: {"type":"transcript.text.delta","delta":"你好","start_time":0,"end_time":10}\n\n'
      )
    )
    await expect(
      transcribeSpeech(
        { audioBytes: Buffer.from([1]), audioFormat: 'mp3' },
        dependencies(missingDone)
      )
    ).rejects.toThrow('完整转写')
  })
})
