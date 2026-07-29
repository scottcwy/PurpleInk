import 'server-only'
import { z } from 'zod'
import type {
  OpenAiCompatibleAsrProfile,
  OpenAiCompatibleTtsProfile,
} from '@/features/ai/openai-compatible-payloads'
import {
  providerErrorFromResponse,
  providerNetworkError,
} from '@/features/ai/provider-request-error'
import { withProviderDispatch } from '@/features/ai/provider-dispatch'
import type { Caption } from './types'
import type { SynthesizedSpeech, TranscribedSpeech } from './stepfun-audio-client'

/**
 * 标准 OpenAI 音频协议的客户端。
 *
 * 为什么不复用现有两家：StepFun 的 ASR 打 `/audio/asr/sse` 并走 SSE 增量协议，
 * MiMo 把 TTS 与 ASR 都塞进 `/chat/completions`。这里是官方形状——
 * `POST /audio/speech`（JSON 请求，响应是裸音频字节）与
 * `POST /audio/transcriptions`（multipart/form-data，三家里唯一的非 JSON 请求体）。
 *
 * 端点、模型、音色、容器格式与时间戳能力全部来自用户 profile，本模块不猜默认值。
 */

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

/** `json` 形状：只有整段文本，没有时间戳。 */
const plainTranscriptSchema = z
  .object({ text: z.string().trim().min(1) })
  .passthrough()

/**
 * `verbose_json` 形状。`start` / `end` 是**秒**为单位的浮点，转 `Caption` 时按毫秒
 * 取整——这里错一个数量级，全部字幕会挤在第 0 毫秒。
 */
const verboseTranscriptSchema = z
  .object({
    text: z.string().trim().min(1),
    segments: z
      .array(
        z
          .object({
            text: z.string(),
            start: z.number().nonnegative(),
            end: z.number().nonnegative(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
  })
  .passthrough()

export interface OpenAiCompatibleTtsDependencies {
  fetcher: typeof fetch
  getProfile: () => Promise<OpenAiCompatibleTtsProfile | null>
  getApiKey: () => Promise<string | null>
  dispatch?: typeof withProviderDispatch
}

export interface OpenAiCompatibleAsrDependencies {
  fetcher: typeof fetch
  getProfile: () => Promise<OpenAiCompatibleAsrProfile | null>
  getApiKey: () => Promise<string | null>
  dispatch?: typeof withProviderDispatch
}

export interface OpenAiCompatibleTranscription extends TranscribedSpeech {
  /** 本次转写实际使用的时间戳模式，由 profile 决定，不在运行期探测。 */
  timestampMode: 'segment' | 'none'
}

const PROVIDER_TIMEOUT_MS = 45_000

export async function synthesizeOpenAiCompatibleSpeech(
  input: z.input<typeof speechInputSchema>,
  dependencies: OpenAiCompatibleTtsDependencies,
): Promise<SynthesizedSpeech> {
  const parsed = speechInputSchema.parse(input)
  const { profile, apiKey } = await resolveTts(dependencies)
  return (dependencies.dispatch ?? withProviderDispatch)({
    providerId: 'openai-compatible-tts',
    providerLabel: '自定义兼容 TTS',
    funding: 'byok',
    apiKey,
    tokenEstimate: Array.from(parsed.text).length,
  }, async () => {
  const response = await request(
    dependencies.fetcher,
    endpoint(profile.baseUrl, 'audio/speech'),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: profile.model,
        input: parsed.text,
        voice: parsed.voiceId ?? profile.voice,
        response_format: profile.audioFormat,
      }),
    },
    '自定义兼容 TTS',
  )
  if (!response.ok) {
    throw providerErrorFromResponse({
      response,
      providerId: 'openai-compatible-tts',
      providerLabel: '自定义兼容 TTS',
      operation: '配音',
      funding: 'byok',
    })
  }
  const audioBytes = Buffer.from(await response.arrayBuffer())
  if (audioBytes.length === 0) {
    throw new Error('自定义兼容 TTS 未返回音频字节')
  }
  return {
    audioBytes,
    audioFormat: profile.audioFormat,
    // 该协议不返回时长与原生字幕。时长由 `measureAudio` 解码真实字节实测，
    // 这里返回 0 而不是估算值。
    durationMs: 0,
    model: profile.model,
    nativeCaptions: [],
  }
  })
}

export async function transcribeOpenAiCompatibleSpeech(
  input: z.input<typeof transcriptionInputSchema>,
  dependencies: OpenAiCompatibleAsrDependencies,
): Promise<OpenAiCompatibleTranscription> {
  const parsed = transcriptionInputSchema.parse(input)
  const { profile, apiKey } = await resolveAsr(dependencies)
  return (dependencies.dispatch ?? withProviderDispatch)({
    providerId: 'openai-compatible-asr',
    providerLabel: '自定义兼容 ASR',
    funding: 'byok',
    apiKey,
  }, async () => {
  const response = await request(
    dependencies.fetcher,
    endpoint(profile.baseUrl, 'audio/transcriptions'),
    {
      method: 'POST',
      // 不显式设置 content-type：multipart 的 boundary 必须由 FormData 生成。
      headers: { authorization: `Bearer ${apiKey}` },
      body: transcriptionForm(
        parsed.audioBytes,
        parsed.audioFormat,
        profile.model,
        profile.timestampMode,
      ),
    },
    '自定义兼容 ASR',
  )
  if (!response.ok) {
    throw providerErrorFromResponse({
      response,
      providerId: 'openai-compatible-asr',
      providerLabel: '自定义兼容 ASR',
      operation: '语音识别',
      funding: 'byok',
    })
  }
  const payload: unknown = await response.json()
  const { transcript, captions } = profile.timestampMode === 'segment'
    ? readVerbose(payload)
    : { transcript: plainTranscriptSchema.parse(payload).text, captions: [] }
  return {
    transcript,
    model: profile.model,
    captions,
    timestampMode: profile.timestampMode,
  }
  })
}

/**
 * 组装 multipart 请求体。
 *
 * `timestamp_granularities[]` 只在 `verbose_json` 下有意义，且 profile 的
 * `timestampMode` 已经在「校验并保存」时用一次真实调用协商过，所以这里不做探测、
 * 不做失败重试——运行期每个字幕节点都多打一次必然失败的请求是不可接受的。
 */
export function transcriptionForm(
  audioBytes: Buffer,
  audioFormat: 'mp3' | 'wav',
  model: string,
  timestampMode: 'segment' | 'none',
): FormData {
  const form = new FormData()
  const mime = audioFormat === 'wav' ? 'audio/wav' : 'audio/mpeg'
  form.append(
    'file',
    new Blob([new Uint8Array(audioBytes)], { type: mime }),
    `audio.${audioFormat}`,
  )
  form.append('model', model)
  if (timestampMode === 'segment') {
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
  } else {
    form.append('response_format', 'json')
  }
  return form
}

/** 秒 → 毫秒整数。空文本分段会被丢弃，避免产出零长度字幕。 */
export function readVerbose(
  payload: unknown,
): { transcript: string; captions: Caption[] } {
  const body = verboseTranscriptSchema.parse(payload)
  const captions = body.segments.flatMap<Caption>((segment) => {
    const text = segment.text.trim()
    const startMs = Math.round(segment.start * 1000)
    const endMs = Math.round(segment.end * 1000)
    return text && endMs > startMs ? [{ text, startMs, endMs }] : []
  })
  return { transcript: body.text, captions }
}

async function resolveTts(
  dependencies: OpenAiCompatibleTtsDependencies,
): Promise<{ profile: OpenAiCompatibleTtsProfile; apiKey: string }> {
  const [profile, apiKey] = await Promise.all([
    dependencies.getProfile(),
    dependencies.getApiKey(),
  ])
  if (!profile) throw new Error('自定义兼容 TTS 端点尚未配置')
  if (!apiKey) throw new Error('尚未配置自定义兼容 TTS 端点的 API Key')
  return { profile, apiKey }
}

async function resolveAsr(
  dependencies: OpenAiCompatibleAsrDependencies,
): Promise<{ profile: OpenAiCompatibleAsrProfile; apiKey: string }> {
  const [profile, apiKey] = await Promise.all([
    dependencies.getProfile(),
    dependencies.getApiKey(),
  ])
  if (!profile) throw new Error('自定义兼容 ASR 端点尚未配置')
  if (!apiKey) throw new Error('尚未配置自定义兼容 ASR 端点的 API Key')
  return { profile, apiKey }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path}`
}

async function request(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  try {
    return await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
  } catch (error) {
    throw providerNetworkError({
      providerId: operation.includes('TTS')
        ? 'openai-compatible-tts'
        : 'openai-compatible-asr',
      providerLabel: operation.includes('TTS')
        ? '自定义兼容 TTS'
        : '自定义兼容 ASR',
      operation,
      funding: 'byok',
      cause: error,
    })
  }
}
