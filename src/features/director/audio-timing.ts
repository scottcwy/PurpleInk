import { createHash } from 'node:crypto'
import type { NarrationResult, NarrationUnit } from '@/features/audio'
import {
  audioAllocationSchema,
  audioManifestSchema,
  type AudioAllocation,
  type AudioManifest,
  type ScriptUnit,
} from './schemas/ingest'

/**
 * 由**实测旁白**派生 audio manifest 与 allocation。
 *
 * 每个 script unit 对应一段独立音频文件，因此对齐口径是 `unit-file` / `unit-files`
 * 且 coverage 为 1：分镜边界就是音频文件边界，不存在需要回退的时长权重估算。
 * 帧数取自实测时长向上取整，保证画面不会早于旁白结束。
 */

export const MASTER_FPS = 30
export const DIGEST_POLICY_VERSION = 'cvc.audio-digest/v1'

export type TimelineFps = AudioAllocation['fps']

export function buildMeasuredAudioManifest(
  scriptUnits: readonly ScriptUnit[],
  narration: NarrationResult
): AudioManifest {
  const units = scriptUnits.map((unit) => {
    const measured = requireMeasured(narration.units, unit)
    const anchors = nativeAnchors(measured)
    return {
      unitId: unit.unitId,
      text: unit.text,
      audioFile: measured.audioKey,
      durationMs: measured.durationMs,
      source: 'tts' as const,
      sampleRateHz: measured.sampleRateHz,
      sampleCount: measured.sampleCount,
      sha256: `sha256:${measured.contentHash}`,
      alignment: {
        mode: anchors ? ('tts-native' as const) : ('unit-file' as const),
        coverage: 1,
        confidence: 1,
        sourceStartSample: 0,
        sourceEndSample: measured.sampleCount,
      },
      ...(anchors ? { anchors } : {}),
    }
  })
  const allNative = units.every(
    (unit) => unit.alignment.mode === 'tts-native'
  )
  return audioManifestSchema.parse({
    version: 1,
    contractVersion: 'vnext-audio-v1',
    digestPolicyVersion: DIGEST_POLICY_VERSION,
    engine: narration.engine,
    voice: narration.voice,
    units,
    totalMs: units.reduce((total, unit) => total + unit.durationMs, 0),
    alignmentReport: {
      policy: allNative ? 'tts-native' : 'unit-files',
      scriptCoverage: 1,
      continuousCoverage: true,
      lowConfidenceUnitIds: [],
    },
  })
}

function nativeAnchors(
  narration: NarrationUnit
): Array<{
  startChar: number
  endChar: number
  startSample: number
  endSample: number
  confidence: number
}> | null {
  if (narration.nativeCaptions.length === 0) return null
  let cursor = 0
  let previousEndMs = 0
  const anchors = []
  for (const caption of narration.nativeCaptions) {
    if (
      caption.startMs < previousEndMs ||
      caption.endMs <= caption.startMs ||
      caption.endMs > narration.durationMs ||
      !narration.text.startsWith(caption.text, cursor)
    ) {
      return null
    }
    const endChar = cursor + caption.text.length
    anchors.push({
      startChar: cursor,
      endChar,
      startSample: Math.round(
        (caption.startMs * narration.sampleRateHz) / 1_000
      ),
      endSample: Math.min(
        narration.sampleCount,
        Math.round((caption.endMs * narration.sampleRateHz) / 1_000)
      ),
      confidence: 1,
    })
    cursor = endChar
    previousEndMs = caption.endMs
  }
  return cursor === narration.text.length ? anchors : null
}

export function buildMeasuredAudioAllocation(
  scriptUnits: readonly ScriptUnit[],
  audioManifest: AudioManifest,
  fps: TimelineFps = MASTER_FPS
): AudioAllocation {
  const shots = scriptUnits.map((unit, index) => {
    const measured = requireManifestUnit(audioManifest, unit.unitId)
    const sampleCount = measured.sampleCount ?? 0
    return {
      id: shotIdFor(index),
      audioUnitId: unit.unitId,
      scriptRange: { startChar: 0, endChar: unit.text.length },
      substring: unit.text,
      startInUnitMs: 0,
      endInUnitMs: measured.durationMs,
      startSample: 0,
      endSample: sampleCount,
      durationInFrames: framesFor(measured.durationMs, fps),
      allocationMethod: 'unit-boundary' as const,
    }
  })
  return audioAllocationSchema.parse({
    schemaVersion: 1,
    inputDigests: {
      audioManifest: sha256Digest(JSON.stringify(audioManifest)),
      runtimeBindings: sha256Digest(
        JSON.stringify({
          engine: audioManifest.engine,
          voice: audioManifest.voice ?? null,
          fps,
        })
      ),
      scriptUnits: sha256Digest(JSON.stringify(scriptUnits)),
    },
    fps,
    shots,
    totalFrames: shots.reduce((total, shot) => total + shot.durationInFrames, 0),
  })
}

export function shotIdFor(index: number): string {
  return `S${String(index + 1).padStart(3, '0')}`
}

/** 向上取整：画面必须覆盖完整旁白，宁可多一帧也不截断语音。 */
function framesFor(durationMs: number, fps: number): number {
  return Math.max(1, Math.ceil((durationMs * fps) / 1000))
}

function requireMeasured(
  units: readonly NarrationUnit[],
  scriptUnit: ScriptUnit
): NarrationUnit {
  const measured = units.find((unit) => unit.unitId === scriptUnit.unitId)
  if (!measured) {
    throw new Error(`缺少 ${scriptUnit.unitId} 的实测旁白音频`)
  }
  if (measured.text !== scriptUnit.text) {
    throw new Error(`${scriptUnit.unitId} 的旁白文本与 script unit 不一致`)
  }
  return measured
}

function requireManifestUnit(
  audioManifest: AudioManifest,
  unitId: string
): AudioManifest['units'][number] {
  const unit = audioManifest.units.find((item) => item.unitId === unitId)
  if (!unit) throw new Error(`audio manifest 中找不到 ${unitId}`)
  if (unit.sampleCount === undefined) {
    throw new Error(`${unitId} 缺少实测采样数`)
  }
  return unit
}

function sha256Digest(input: string): string {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`
}
