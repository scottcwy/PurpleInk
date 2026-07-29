import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ProviderDispatchWaitError } from '@/features/ai/provider-dispatch-wait-error'
import { measureAudio, type MeasuredAudio } from './measure'
import {
  registerNarrationAudio,
  reuseNarrationAudio,
  type NarrationAudioRecord,
} from './narration-repository'
import {
  resolveNarrationEngine,
  synthesizeRoutedSpeech,
  type NarrationEngine,
  type SynthesizedSpeech,
} from './media-provider'
import type { Caption } from './types'
import type { AudioBillingContext } from './managed-audio-billing'

/**
 * INGEST 阶段的旁白合成：每个 script unit 一段真实 TTS 音频。
 *
 * 时长在这里就被实测出来，因此 FABRICATE 的帧数可以来自真实旁白，
 * 不再需要任何占位时长。任一 unit 合成失败即整体失败，不回退占位。
 */

const unitSchema = z
  .object({
    unitId: z.string().regex(/^U\d{3}$/),
    text: z.string().trim().min(1),
  })
  .strict()

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    units: z.array(unitSchema).min(1),
    voiceId: z.string().trim().min(1).optional(),
    concurrency: z.number().int().min(1).optional(),
    billingContext: z.object({
      attemptId: z.string().min(1),
      invocationNo: z.number().int().min(1),
    }).strict().optional(),
  })
  .strict()

export type NarrationInput = z.input<typeof inputSchema>

export interface NarrationUnit {
  unitId: string
  text: string
  /** 真实音频字节的存储键。 */
  audioKey: string
  audioArtifactId: string
  /** 实际字节的 SHA-256。 */
  contentHash: string
  durationMs: number
  sampleRateHz: number
  sampleCount: number
  nativeCaptions: Caption[]
  /** true 表示命中已有音频字节，本次未再调用 TTS。 */
  reused: boolean
}

export interface NarrationResult {
  engine: string
  voice: string
  units: NarrationUnit[]
}

export interface NarrationDependencies {
  resolveEngine: () => Promise<NarrationEngine>
  synthesize: (input: {
    text: string
    voiceId?: string
    billingContext?: AudioBillingContext
  }) => Promise<SynthesizedSpeech>
  measure: (bytes: Buffer) => Promise<MeasuredAudio>
  reuseAudio: (key: string) => Promise<Buffer | null>
  registerAudio: (input: {
    projectId: string
    nodeId: string
    unitId: string
    audioKey: string
    bytes: Buffer
    contentHash: string
  }) => Promise<NarrationAudioRecord>
}

/** 兼容旧调用的 StepFun 默认音色；实际默认值由当前媒体供应商决定。 */
export const NARRATION_VOICE_ID = 'cixingnansheng'

/**
 * 旁白合成并发上限。INGEST 一次要合成 N 段，串行会让 INGEST 成为整条链路最慢的一步；
 * 与 ISSUE-004 的通道语义一致，不因 TTS 慢就写死成 1。
 */
export const NARRATION_CONCURRENCY = 4

export async function synthesizeNarration(
  input: NarrationInput,
  dependencies: NarrationDependencies = defaultDependencies()
): Promise<NarrationResult> {
  const parsed = inputSchema.parse(input)
  assertUniqueUnitIds(parsed.units)
  const engine = await dependencies.resolveEngine()
  const voice = parsed.voiceId ?? engine.voice
  const units = new Array<NarrationUnit | undefined>(parsed.units.length)
  const requests = parsed.units
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < requests.length) {
      const index = cursor
      cursor += 1
      const request = requests[index]
      if (!request) continue
      units[index] = await synthesizeUnit(
        {
          projectId: parsed.projectId,
          nodeId: parsed.nodeId,
          engine: engine.model,
          audioFormat: engine.audioFormat,
          voice,
          request,
          billingContext: parsed.billingContext
            ? {
                attemptId: parsed.billingContext.attemptId,
                invocationNo: parsed.billingContext.invocationNo + index,
              }
            : undefined,
        },
        dependencies
      )
    }
  }

  const lanes = Math.min(
    parsed.concurrency ?? NARRATION_CONCURRENCY,
    requests.length
  )
  await Promise.all(Array.from({ length: lanes }, worker))
  return { engine: engine.model, voice, units: units.map(requireUnit) }
}

/** 内容寻址：同模型 + 同音色 + 同文本命中同一字节，不重复计费。 */
export function narrationAudioKey(input: {
  projectId: string
  engine: string
  voice: string
  text: string
  audioFormat?: 'mp3' | 'wav'
}): string {
  const digest = createHash('sha256')
    .update([input.engine, input.voice, input.text].join('\u0000'))
    .digest('hex')
  return `narration/${input.projectId}/${digest}.${input.audioFormat ?? 'mp3'}`
}

async function synthesizeUnit(
  context: {
    projectId: string
    nodeId: string
    engine: string
    voice: string
    audioFormat: 'mp3' | 'wav'
    request: z.infer<typeof unitSchema>
    billingContext?: AudioBillingContext
  },
  dependencies: NarrationDependencies
): Promise<NarrationUnit> {
  const audioKey = narrationAudioKey({
    projectId: context.projectId,
    engine: context.engine,
    voice: context.voice,
    text: context.request.text,
    audioFormat: context.audioFormat,
  })
  const cached = await dependencies.reuseAudio(audioKey)
  const speech = cached
    ? null
    : await assertEngine(
        context.engine,
        await synthesizeWithDispatchRetry(context, dependencies)
      )
  const bytes = cached ?? speech?.audioBytes
  if (!bytes || bytes.length === 0) {
    throw new Error(`旁白合成未返回音频字节：${context.request.unitId}`)
  }
  const measured = await dependencies.measure(bytes)
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const record = await dependencies.registerAudio({
    projectId: context.projectId,
    nodeId: context.nodeId,
    unitId: context.request.unitId,
    audioKey,
    bytes,
    contentHash,
  })
  return {
    unitId: context.request.unitId,
    text: context.request.text,
    audioKey: record.audioKey,
    audioArtifactId: record.audioArtifactId,
    contentHash,
    durationMs: measured.durationMs,
    sampleRateHz: measured.sampleRateHz,
    sampleCount: measured.sampleCount,
    nativeCaptions: speech?.nativeCaptions ?? [],
    reused: cached !== null,
  }
}

/** 缓存键绑定模型名；运行中路由漂移必须失败，不能让不同模型的字节混进同一 manifest。 */
function assertEngine(
  engine: string,
  speech: SynthesizedSpeech
): SynthesizedSpeech {
  if (speech.model !== engine) {
    throw new Error(`TTS 模型与配置不一致：${speech.model} != ${engine}`)
  }
  return speech
}

function requireUnit(unit: NarrationUnit | undefined, index: number): NarrationUnit {
  if (!unit) throw new Error(`旁白合成缺少第 ${index + 1} 段结果`)
  return unit
}

function assertUniqueUnitIds(units: readonly { unitId: string }[]): void {
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length) {
    throw new Error('旁白 unitId 必须唯一')
  }
}

function defaultDependencies(): NarrationDependencies {
  return {
    resolveEngine: resolveNarrationEngine,
    synthesize: synthesizeRoutedSpeech,
    measure: measureAudio,
    reuseAudio: reuseNarrationAudio,
    registerAudio: registerNarrationAudio,
  }
}

/**
 * 单段 TTS 调用内部等待重试。
 *
 * Provider 调度器的 pacing / 并发池会在多 worker 同时出网时抛出
 * ProviderDispatchWaitError。如果透传到上层，整个 narration job 会失败并重入队列，
 * 浪费重试预算且极度缓慢。此处在 worker 内部等待 retryAt 后重试，
 * 让并发 worker 自然错开到 minIntervalMs 之外。
 */
const MAX_DISPATCH_RETRIES = 6

async function synthesizeWithDispatchRetry(
  context: {
    request: z.infer<typeof unitSchema>
    voice: string
    billingContext?: AudioBillingContext
  },
  dependencies: NarrationDependencies
): Promise<SynthesizedSpeech> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await dependencies.synthesize({
        text: context.request.text,
        voiceId: context.voice,
        ...(context.billingContext
          ? { billingContext: context.billingContext }
          : {}),
      })
    } catch (error) {
      if (
        !(error instanceof ProviderDispatchWaitError) ||
        attempt >= MAX_DISPATCH_RETRIES
      ) {
        throw error
      }
      const waitMs = Math.max(
        0,
        new Date(error.retryAt!).getTime() - Date.now()
      )
      await sleep(Math.min(waitMs + 50, 5_000))
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
