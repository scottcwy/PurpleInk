import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getStepfunConfig } from '@/features/ai/config'
import { measureMp3, type MeasuredAudio } from './measure'
import {
  registerNarrationAudio,
  reuseNarrationAudio,
  type NarrationAudioRecord,
} from './narration-repository'
import {
  synthesizeSpeech,
  type SynthesizedSpeech,
} from './stepfun-audio-client'
import type { Caption } from './types'

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
  resolveEngine: () => Promise<string>
  synthesize: (input: {
    text: string
    voiceId?: string
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

/** StepFun TTS 默认音色；音色参与缓存键，换音色不会复用旧字节。 */
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
  const voice = parsed.voiceId ?? NARRATION_VOICE_ID
  const engine = await dependencies.resolveEngine()
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
          engine,
          voice,
          request,
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
  return { engine, voice, units: units.map(requireUnit) }
}

/** 内容寻址：同模型 + 同音色 + 同文本命中同一字节，不重复计费。 */
export function narrationAudioKey(input: {
  projectId: string
  engine: string
  voice: string
  text: string
}): string {
  const digest = createHash('sha256')
    .update([input.engine, input.voice, input.text].join('\u0000'))
    .digest('hex')
  return `narration/${input.projectId}/${digest}.mp3`
}

async function synthesizeUnit(
  context: {
    projectId: string
    nodeId: string
    engine: string
    voice: string
    request: z.infer<typeof unitSchema>
  },
  dependencies: NarrationDependencies
): Promise<NarrationUnit> {
  const audioKey = narrationAudioKey({
    projectId: context.projectId,
    engine: context.engine,
    voice: context.voice,
    text: context.request.text,
  })
  const cached = await dependencies.reuseAudio(audioKey)
  const speech = cached
    ? null
    : await assertEngine(
        context.engine,
        await dependencies.synthesize({
          text: context.request.text,
          voiceId: context.voice,
        })
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
    resolveEngine: async () => (await getStepfunConfig()).ttsModel,
    synthesize: synthesizeSpeech,
    measure: measureMp3,
    reuseAudio: reuseNarrationAudio,
    registerAudio: registerNarrationAudio,
  }
}
