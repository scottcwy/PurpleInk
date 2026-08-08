import { createServer, type Server } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { AiProviderError } from '../ai/openai-compatible'
import {
  MAX_AUDIO_BASE64_BYTES,
  assertSupportedAudioSample,
  createMimoSpeechClient,
  type MimoSpeechConfig,
} from './mimo-client'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

describe('MiMo speech client', () => {
  it('uses the official MiMo base URL when none is configured', async () => {
    const requested: string[] = []
    const wav = syntheticWav()
    const client = createMimoSpeechClient(
      {
        apiKey: 'speech-test-token',
        ttsModel: 'mimo-v2.5-tts',
        asrModel: 'mimo-v2.5-asr',
        maxRetries: 0,
      },
      {
        fetch: async (input) => {
          requested.push(String(input))
          return new Response(JSON.stringify({ choices: [{ message: { audio: { data: wav.toString('base64') } } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      },
    )

    await client.synthesize({ text: '默认端点', style: '自然' })

    expect(requested).toEqual(['https://api.xiaomimimo.com/v1/chat/completions'])
  })

  it('sends TTS style as user, target text as assistant, and parses a non-empty WAV', async () => {
    const wav = syntheticWav()
    const provider = await createProvider(() => ({
      choices: [{ message: { audio: { data: wav.toString('base64') } } }],
    }))
    const client = createMimoSpeechClient(config(provider.baseUrl))

    const result = await client.synthesize({ text: '这是目标旁白。', style: '沉稳、清晰。' })

    expect(Buffer.from(result.audio)).toEqual(wav)
    expect(result.mimeType).toBe('audio/wav')
    expect(provider.requests[0]).toMatchObject({
      authorization: 'Bearer speech-test-token',
      path: '/v1/chat/completions',
      body: {
        model: 'mimo-v2.5-tts',
        messages: [
          { role: 'user', content: '沉稳、清晰。' },
          { role: 'assistant', content: '这是目标旁白。' },
        ],
        audio: { format: 'wav', voice: 'mimo_default' },
      },
    })
  })

  it('uses the voice-clone model and a local WAV data URL as audio.voice', async () => {
    const wav = syntheticWav()
    const provider = await createProvider(() => ({
      choices: [{ message: { audio: { data: wav.toString('base64') } } }],
    }))
    const client = createMimoSpeechClient(config(provider.baseUrl))

    await client.synthesize({
      text: '克隆音色。',
      style: '自然。',
      voiceSample: { bytes: wav, mimeType: 'audio/wav' },
    })

    expect(provider.requests[0]?.body).toMatchObject({
      model: 'mimo-v2.5-tts-voiceclone',
      audio: { format: 'wav', voice: `data:audio/wav;base64,${wav.toString('base64')}` },
    })
  })

  it('sends ASR input_audio with a data URL and parses text strictly', async () => {
    const wav = syntheticWav()
    const provider = await createProvider(() => ({ choices: [{ message: { content: '转写文本。' } }] }))
    const client = createMimoSpeechClient(config(provider.baseUrl))

    await expect(client.transcribe({ audio: wav, mimeType: 'audio/wav', language: 'zh' })).resolves.toEqual({
      text: '转写文本。',
    })
    expect(provider.requests[0]?.body).toEqual({
      model: 'mimo-v2.5-asr',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}` },
            },
          ],
        },
      ],
      asr_options: { language: 'zh' },
    })
  })

  it('accepts exactly 10 MiB of Base64 and rejects the next encoded block', () => {
    const exact = Buffer.alloc((MAX_AUDIO_BASE64_BYTES / 4) * 3)
    const tooLarge = Buffer.alloc(exact.byteLength + 1)

    expect(assertSupportedAudioSample(exact, 'audio/mpeg').base64).toHaveLength(MAX_AUDIO_BASE64_BYTES)
    expect(() => assertSupportedAudioSample(tooLarge, 'audio/mpeg')).toThrow(
      expect.objectContaining({ code: 'AUDIO_SAMPLE_TOO_LARGE' }),
    )
  })

  it('retries 429 once and never exposes key or provider response text', async () => {
    const wav = syntheticWav()
    let calls = 0
    const provider = await createProvider(() => {
      calls += 1
      return calls === 1
        ? { status: 429, body: { error: 'private-provider-payload' } }
        : { choices: [{ message: { audio: { data: wav.toString('base64') } } }] }
    })
    const client = createMimoSpeechClient({ ...config(provider.baseUrl), maxRetries: 1, retryBaseDelayMs: 0 })

    await expect(client.synthesize({ text: '重试', style: '正常' })).resolves.toBeDefined()
    expect(calls).toBe(2)

    const failed = await createProvider(() => ({
      status: 500,
      body: { error: 'private-provider-payload' },
    }))
    const failedClient = createMimoSpeechClient({ ...config(failed.baseUrl), maxRetries: 0 })
    await expect(failedClient.synthesize({ text: '失败', style: '正常' })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AiProviderError &&
        error.code === 'AI_PROVIDER_UNAVAILABLE' &&
        !error.message.includes('private-provider-payload') &&
        !error.message.includes('speech-test-token'),
    )
  })
})

function config(baseUrl: string): MimoSpeechConfig {
  return {
    baseUrl: `${baseUrl}/v1`,
    apiKey: 'speech-test-token',
    ttsModel: 'mimo-v2.5-tts',
    voiceCloneModel: 'mimo-v2.5-tts-voiceclone',
    asrModel: 'mimo-v2.5-asr',
    requestTimeoutMs: 1_000,
    maxRetries: 0,
  }
}

function syntheticWav(): Buffer {
  const wav = Buffer.alloc(46)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(38, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24_000, 24)
  wav.writeUInt32LE(48_000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(2, 40)
  return wav
}

type ProviderValue = Record<string, unknown> | { status: number; body: Record<string, unknown> }

async function createProvider(respond: () => ProviderValue): Promise<{
  baseUrl: string
  requests: Array<{ authorization: string; path: string; body: Record<string, unknown> }>
}> {
  const requests: Array<{ authorization: string; path: string; body: Record<string, unknown> }> = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk.toString()
    })
    request.on('end', () => {
      requests.push({
        authorization: request.headers.authorization ?? '',
        path: request.url ?? '',
        body: JSON.parse(raw) as Record<string, unknown>,
      })
      const value = respond()
      const failure =
        typeof value.status === 'number' &&
        typeof value.body === 'object' &&
        value.body !== null &&
        !Array.isArray(value.body)
          ? { status: value.status, body: value.body as Record<string, unknown> }
          : null
      const status = failure?.status ?? 200
      const body = failure?.body ?? value
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('provider did not bind')
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests }
}
