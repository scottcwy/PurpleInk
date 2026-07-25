import 'server-only'
import { z } from 'zod'
import { getStepfunConfig, type StepfunConfig } from '@/features/ai/config'
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
          .min(1),
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
  getConfig: () => Promise<StepfunConfig>
}

export interface SynthesizedSpeech {
  audioBytes: Buffer
  audioFormat: 'mp3'
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

export async function synthesizeSpeech(
  input: z.input<typeof speechInputSchema>,
  dependencies: StepfunAudioDependencies = defaultDependencies()
): Promise<SynthesizedSpeech> {
  const parsed = speechInputSchema.parse(input)
  const config = requireKey(await dependencies.getConfig())
  const response = await dependencies.fetcher(
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
        timestamp: true,
      }),
    }
  )
  if (!response.ok) {
    throw new Error(`StepFun TTS 请求失败（HTTP ${response.status}）`)
  }
  const body = ttsResponseSchema.parse(await response.json())
  const nativeCaptions = body.data.subtitles.flatMap(({ items }) =>
    items.map(({ text, start_time, end_time }) => ({
      text,
      startMs: start_time,
      endMs: end_time,
    }))
  )
  if (nativeCaptions.length === 0) {
    throw new Error('StepFun TTS 未返回可用的词级时间戳')
  }
  const audioResponse = await dependencies.fetcher(body.data.url)
  if (!audioResponse.ok) {
    throw new Error(`StepFun TTS 音频下载失败（HTTP ${audioResponse.status}）`)
  }
  return {
    audioBytes: Buffer.from(await audioResponse.arrayBuffer()),
    audioFormat: 'mp3',
    durationMs: Math.max(...nativeCaptions.map(({ endMs }) => endMs)),
    model: config.ttsModel,
    nativeCaptions,
  }
}

export async function transcribeSpeech(
  input: z.input<typeof transcriptionInputSchema>,
  dependencies: StepfunAudioDependencies = defaultDependencies()
): Promise<TranscribedSpeech> {
  const parsed = transcriptionInputSchema.parse(input)
  const config = requireKey(await dependencies.getConfig())
  const response = await dependencies.fetcher(
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
    }
  )
  if (!response.ok) {
    throw new Error(`StepFun ASR 请求失败（HTTP ${response.status}）`)
  }
  const events = parseSse(await response.text())
  const captions: Caption[] = []
  let transcript: string | undefined
  for (const event of events) {
    const errorEvent = asrErrorSchema.safeParse(event)
    if (errorEvent.success) throw new Error(`StepFun ASR 失败：${errorEvent.data.message}`)
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

function requireKey(config: StepfunConfig): StepfunConfig & { apiKey: string } {
  if (!config.apiKey) throw new Error('尚未配置 StepFun API Key')
  return { ...config, apiKey: config.apiKey }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path}`
}

function defaultDependencies(): StepfunAudioDependencies {
  return { fetcher: fetch, getConfig: getStepfunConfig }
}
