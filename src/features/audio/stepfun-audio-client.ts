import 'server-only'
import { z } from 'zod'
import {
  resolveBuiltInAudioConfig,
  type BuiltInAudioConfig,
} from '@/features/ai/built-in-audio-config'
import {
  providerErrorFromResponse,
  providerNetworkError,
  ProviderRequestError,
} from '@/features/ai/provider-request-error'
import type { Caption } from './types'

const speechInputSchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    voiceId: z.string().trim().min(1).optional(),
  })
  .strict()

const transcriptionInputSchema = z
  .object({
    audioBytes: z.instanceof(Buffer).refine((bytes) => bytes.length > 0),
    audioFormat: z.enum(['mp3', 'wav', 'ogg', 'pcm']),
  })
  .strict()

const ttsResponseSchema = z
  .object({
    data: z
      .object({
        url: z.string().url(),
        subtitles: z
          .array(
            z
              .object({
                text: z.string(),
                request_id: z.string(),
                timestamp: z.number().optional(),
                items: z.array(
                  z
                    .object({
                      text: z.string().min(1),
                      start_time: z.number().int().nonnegative(),
                      end_time: z.number().int().positive(),
                    })
                    .strict()
                ),
              })
              .passthrough()
          )
          .optional()
          .default([]),
      })
      .passthrough(),
  })
  .passthrough()

const asrDeltaSchema = z
  .object({
    type: z.literal('transcript.text.delta'),
    delta: z.string(),
    start_time: z.number().int().nonnegative().optional(),
    end_time: z.number().int().positive().optional(),
  })
  .passthrough()

const asrDoneSchema = z
  .object({
    type: z.literal('transcript.text.done'),
    text: z.string().min(1),
  })
  .passthrough()

const asrErrorSchema = z
  .object({
    type: z.literal('error'),
    message: z.string().min(1),
  })
  .passthrough()

export interface StepfunAudioDependencies {
  fetcher: typeof fetch
  getConfig: () => Promise<BuiltInAudioConfig>
}

export interface SynthesizedSpeech {
  audioBytes: Buffer
  audioFormat: 'mp3' | 'wav'
  durationMs: number
  model: string
  nativeCaptions: Caption[]
}

export interface TranscribedSpeech {
  transcript: string
  model: string
  captions: Caption[]
}

const DEFAULT_VOICE_ID = 'cixingnansheng'
const PROVIDER_TIMEOUT_MS = 45_000

export async function synthesizeSpeech(
  input: z.input<typeof speechInputSchema>,
  dependencies: StepfunAudioDependencies = defaultDependencies()
): Promise<SynthesizedSpeech> {
  const parsed = speechInputSchema.parse(input)
  const config = requireKey(await dependencies.getConfig())
  const response = await request(
    dependencies.fetcher,
    endpoint(config.baseUrl, 'audio/speech'),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.ttsModel,
        voice: parsed.voiceId ?? DEFAULT_VOICE_ID,
        input: parsed.text,
        response_format: 'mp3',
        return_url: true,
      }),
    },
    'StepFun TTS',
  )
  if (!response.ok) {
    throw providerErrorFromResponse({
      response,
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      operation: '配音',
      funding: 'managed',
    })
  }
  if (response.headers.get('content-type')?.startsWith('audio/')) {
    return {
      audioBytes: Buffer.from(await response.arrayBuffer()),
      audioFormat: 'mp3',
      durationMs: 0,
      model: config.ttsModel,
      nativeCaptions: [],
    }
  }
  const body = ttsResponseSchema.parse(await response.json())
  const nativeCaptions = body.data.subtitles.flatMap(({ items }) =>
    items.map(({ text, start_time, end_time }) => ({
      text,
      startMs: start_time,
      endMs: end_time,
    }))
  )
  const audioResponse = await request(
    dependencies.fetcher,
    body.data.url,
    undefined,
    'StepFun TTS 音频下载',
  )
  if (!audioResponse.ok) {
    throw providerErrorFromResponse({
      response: audioResponse,
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      operation: '音频下载',
      funding: 'managed',
    })
  }
  return {
    audioBytes: Buffer.from(await audioResponse.arrayBuffer()),
    audioFormat: 'mp3',
    durationMs: nativeCaptions.length > 0
      ? Math.max(...nativeCaptions.map(({ endMs }) => endMs))
      : 0,
    model: config.ttsModel,
    nativeCaptions,
  }
}

export async function transcribeSpeech(
  input: z.input<typeof transcriptionInputSchema>,
  dependencies: StepfunAudioDependencies = defaultDependencies(),
  options: { signal?: AbortSignal } = {},
): Promise<TranscribedSpeech> {
  options.signal?.throwIfAborted()
  const parsed = transcriptionInputSchema.parse(input)
  const config = requireKey(await dependencies.getConfig())
  const response = await request(
    dependencies.fetcher,
    endpoint(config.baseUrl, 'audio/asr/sse'),
    {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio: {
          data: parsed.audioBytes.toString('base64'),
          input: {
            transcription: {
              language: 'zh',
              model: config.asrModel,
              enable_itn: true,
              enable_timestamp: true,
            },
            format: { type: parsed.audioFormat },
          },
        },
      }),
    },
    'StepFun ASR',
    options.signal,
  )
  if (!response.ok) {
    throw providerErrorFromResponse({
      response,
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      operation: '语音识别',
      funding: 'managed',
    })
  }
  const events = parseSse(await response.text())
  const captions: Caption[] = []
  let transcript: string | undefined
  for (const event of events) {
    const errorEvent = asrErrorSchema.safeParse(event)
    if (errorEvent.success) {
      throw new ProviderRequestError({
        providerId: 'stepfun',
        providerLabel: '阶跃星辰',
        operation: '语音识别',
        funding: 'managed',
        kind: 'unknown',
      })
    }
    const doneEvent = asrDoneSchema.safeParse(event)
    if (doneEvent.success) {
      transcript = doneEvent.data.text
      continue
    }
    const deltaEvent = asrDeltaSchema.safeParse(event)
    if (
      deltaEvent.success &&
      deltaEvent.data.delta &&
      deltaEvent.data.start_time !== undefined &&
      deltaEvent.data.end_time !== undefined
    ) {
      captions.push({
        text: deltaEvent.data.delta,
        startMs: deltaEvent.data.start_time,
        endMs: deltaEvent.data.end_time,
      })
    }
  }
  if (!transcript) throw new Error('StepFun ASR 未返回完整转写')
  return { transcript, model: config.asrModel, captions }
}

function parseSse(text: string): unknown[] {
  const events: unknown[] = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data || data === '[DONE]') continue
    try {
      events.push(JSON.parse(data) as unknown)
    } catch {
      throw new Error('StepFun ASR SSE 包含无效 JSON')
    }
  }
  return events
}

function requireKey(
  config: BuiltInAudioConfig,
): BuiltInAudioConfig & { apiKey: string } {
  if (!config.apiKey) throw new Error('尚未配置 StepFun API Key')
  return { ...config, apiKey: config.apiKey }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path}`
}

async function request(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  operation: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    externalSignal?.throwIfAborted()
    const timeoutSignal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutSignal])
      : timeoutSignal
    const response = fetcher(url, { ...init, signal })
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(Object.assign(new Error('request timeout'), { name: 'TimeoutError' }))
      }, PROVIDER_TIMEOUT_MS)
    })
    return await Promise.race([response, timeout])
  } catch (error) {
    externalSignal?.throwIfAborted()
    throw providerNetworkError({
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      operation,
      funding: 'managed',
      cause: error,
    })
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function defaultDependencies(): StepfunAudioDependencies {
  return {
    fetcher: fetch,
    getConfig: () => resolveBuiltInAudioConfig('stepfun'),
  }
}
