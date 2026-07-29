import { describe, expect, it, vi } from 'vitest'
import {
  synthesizeMimoSpeech,
  transcribeMimoSpeech,
} from './mimo-audio-client'

vi.mock('server-only', () => ({}))

const config = {
  apiKey: 'sk-product-key',
  baseUrl: 'https://api.xiaomimimo.com/v1',
  textModel: 'mimo-v2.5',
  visionModel: 'mimo-v2.5',
  ttsModel: 'mimo-v2.5-tts',
  asrModel: 'mimo-v2.5-asr',
}

describe('MiMo audio client', () => {
  it('synthesizes WAV through Chat Completions with assistant speech text', async () => {
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = []
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requests.push([input, init])
      return Response.json({
        choices: [{
          message: {
            audio: { data: Buffer.from('real-wav').toString('base64') },
          },
        }],
      })
    })

    const result = await synthesizeMimoSpeech(
      { text: '你好，MiMo。', voiceId: '冰糖' },
      {
        fetcher,
        getConfig: async () => config,
        dispatch: async (_input, invoke) => invoke(),
      }
    )

    const [, init] = requests[0]!
    const body = JSON.parse(String(init?.body))
    expect(body.messages.at(-1)).toEqual({
      role: 'assistant',
      content: '你好，MiMo。',
    })
    expect(body.audio).toEqual({ format: 'wav', voice: '冰糖' })
    expect(result).toMatchObject({
      audioFormat: 'wav',
      model: 'mimo-v2.5-tts',
      nativeCaptions: [],
    })
    expect(result.audioBytes.equals(Buffer.from('real-wav'))).toBe(true)
  })

  it('transcribes a data URL through the official ASR request shape', async () => {
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = []
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requests.push([input, init])
      return Response.json({
        choices: [{ message: { content: '这是准确转写。' } }],
      })
    })

    const result = await transcribeMimoSpeech(
      { audioBytes: Buffer.from('mp3'), audioFormat: 'mp3' },
      {
        fetcher,
        getConfig: async () => config,
        dispatch: async (_input, invoke) => invoke(),
      }
    )

    const [, init] = requests[0]!
    const body = JSON.parse(String(init?.body))
    expect(body.messages[0].content[0]).toMatchObject({
      type: 'input_audio',
      input_audio: {
        data: expect.stringMatching(/^data:audio\/mpeg;base64,/),
      },
    })
    expect(body.asr_options).toEqual({ language: 'auto' })
    expect(result).toEqual({
      transcript: '这是准确转写。',
      model: 'mimo-v2.5-asr',
      captions: [],
    })
  })
})
