import 'server-only'
import { z } from 'zod'
import {
  resolveBuiltInAudioConfig,
  type BuiltInAudioConfig,
} from '@/features/ai/built-in-audio-config'
import {
  providerErrorFromResponse,
  providerNetworkError,
} from '@/features/ai/provider-request-error'
import type {
  SynthesizedSpeech,
  TranscribedSpeech,
} from './stepfun-audio-client'

const speechInputSchema = z
  .object({
    text: z.string().trim().min(1),
    voiceId: z.string().trim().min(1).optional(),
  })
  .strict()

const transcriptionInputSchema = z
  .object({
    audioBytes: z.instanceof(Buffer).refine((bytes) => bytes.length > 0),
    audioFormat: z.enum(['mp3', 'wav']),
  })
  .strict()

const ttsResponseSchema = z
  .object({
    choices: z.array(z.object({
      message: z.object({
        audio: z.object({ data: z.string().min(1) }),
      }).passthrough(),
    }).passthrough()).min(1),
  })
  .passthrough()

const asrResponseSchema = z
  .object({
    choices: z.array(z.object({
      message: z.object({
        content: z.string().trim().min(1),
      }).passthrough(),
    }).passthrough()).min(1),
  })
  .passthrough()

export interface MimoAudioDependencies {
  fetcher: typeof fetch
  getConfig: () => Promise<BuiltInAudioConfig>
}

const DEFAULT_VOICE = 'mimo_default'
const PROVIDER_TIMEOUT_MS = 45_000

export async function synthesizeMimoSpeech(
  input: z.input<typeof speechInputSchema>,
  dependencies: MimoAudioDependencies = defaultDependencies()
): Promise<SynthesizedSpeech> {
  const parsed = speechInputSchema.parse(input)
  const config = requireKey(await dependencies.getConfig())
  const response = await request(dependencies.fetcher, config, {
    model: config.ttsModel,
    messages: [
      {
        role: 'user',
        content: '自然、清晰、适合产品演示的中文旁白。',
      },
      { role: 'assistant', content: parsed.text },
    ],
    audio: {
      format: 'wav',
      voice: parsed.voiceId ?? DEFAULT_VOICE,
    },
  }, 'MiMo TTS')
  const body = ttsResponseSchema.parse(await response.json())
  const data = body.choices[0]!.message.audio.data.replace(
    /^data:audio\/[^;]+;base64,/,
    ''
  )
  const audioBytes = Buffer.from(data, 'base64')
  if (audioBytes.length === 0) throw new Error('MiMo TTS 未返回音频字节')
  return {
    audioBytes,
    audioFormat: 'wav',
    durationMs: 0,
    model: config.ttsModel,
    nativeCaptions: [],
  }
}

export async function transcribeMimoSpeech(
  input: z.input<typeof transcriptionInputSchema>,
  dependencies: MimoAudioDependencies = defaultDependencies(),
  options: { signal?: AbortSignal } = {},
): Promise<TranscribedSpeech> {
  options.signal?.throwIfAborted()
  const parsed = transcriptionInputSchema.parse(input)
  const config = requireKey(await dependencies.getConfig())
  const mime = parsed.audioFormat === 'wav' ? 'audio/wav' : 'audio/mpeg'
  const response = await request(dependencies.fetcher, config, {
    model: config.asrModel,
    messages: [{
      role: 'user',
      content: [{
        type: 'input_audio',
        input_audio: {
          data: `data:${mime};base64,${parsed.audioBytes.toString('base64')}`,
        },
      }],
    }],
    asr_options: { language: 'auto' },
  }, 'MiMo ASR', options.signal)
  const body = asrResponseSchema.parse(await response.json())
  return {
    transcript: body.choices[0]!.message.content,
    model: config.asrModel,
    captions: [],
  }
}

async function request(
  fetcher: typeof fetch,
  config: BuiltInAudioConfig & { apiKey: string },
  body: Record<string, unknown>,
  operation: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  try {
    externalSignal?.throwIfAborted()
    const timeoutSignal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    const response = await fetcher(
      `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'api-key': config.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: externalSignal
          ? AbortSignal.any([externalSignal, timeoutSignal])
          : timeoutSignal,
      }
    )
    if (!response.ok) {
      throw providerErrorFromResponse({
        response,
        providerId: 'mimo',
        providerLabel: '小米 MiMo',
        operation,
        funding: 'managed',
      })
    }
    return response
  } catch (error) {
    externalSignal?.throwIfAborted()
    throw providerNetworkError({
      providerId: 'mimo',
      providerLabel: '小米 MiMo',
      operation,
      funding: 'managed',
      cause: error,
    })
  }
}

function requireKey(
  config: BuiltInAudioConfig,
): BuiltInAudioConfig & { apiKey: string } {
  if (!config.apiKey) throw new Error('尚未配置 MiMo 产品 API Key')
  return { ...config, apiKey: config.apiKey }
}

function defaultDependencies(): MimoAudioDependencies {
  return {
    fetcher: fetch,
    getConfig: () => resolveBuiltInAudioConfig('mimo'),
  }
}
