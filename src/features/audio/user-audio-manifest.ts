import { buildMeasuredAudioAllocation } from '@/features/director/audio-timing'
import {
  audioManifestSchema,
  scriptUnitsSchema,
  type AudioAllocation,
  type AudioManifest,
  type ScriptUnit,
} from '@/features/director/schemas/ingest'
import type { UserRecordingAudioSlice } from './user-audio-slicer'

const USER_AUDIO_ENGINE = 'user-recording-asr'
const USER_AUDIO_DIGEST_POLICY = 'cvc.audio-digest/v1'

export interface StoredUserAudioSlice {
  storageKey: string
  slice: UserRecordingAudioSlice
}

export interface UserAudioContractsInput {
  scriptUnits: readonly ScriptUnit[]
  sourceStorageKey: string
  sourceContentHash: string
  slices: readonly StoredUserAudioSlice[]
}

export interface UserAudioContracts {
  audioManifest: AudioManifest
  audioAllocation: AudioAllocation
}

/**
 * 把用户原录音的真实 WAV 切片投影成既有 Director 音频合同。
 *
 * 每个 unit 都指向最终落盘字节并保留其在原录音中的采样区间；`source: user`
 * 是下游区分“用户原声”和 TTS 的唯一真值。
 */
export function buildUserAudioContracts(
  input: UserAudioContractsInput,
): UserAudioContracts {
  const scriptUnits = scriptUnitsSchema.parse(input.scriptUnits)
  if (input.slices.length !== scriptUnits.length) {
    throw new Error('用户录音切片与 script units 数量不一致')
  }

  const units = scriptUnits.map((unit, index) => {
    const stored = input.slices[index]
    if (!stored || stored.slice.unitId !== unit.unitId || stored.slice.text !== unit.text) {
      throw new Error(`用户录音切片无法对应 ${unit.unitId}`)
    }
    return {
      unitId: unit.unitId,
      text: unit.text,
      audioFile: stored.storageKey,
      durationMs: stored.slice.durationMs,
      source: 'user' as const,
      sampleRateHz: stored.slice.sampleRateHz,
      sampleCount: stored.slice.sampleCount,
      sha256: `sha256:${stored.slice.contentHash}` as const,
      alignment: {
        mode: 'unit-file' as const,
        coverage: 1,
        confidence: 1,
        sourceStartSample: stored.slice.startSample,
        sourceEndSample: stored.slice.endSample,
      },
    }
  })

  const audioManifest = audioManifestSchema.parse({
    version: 1,
    contractVersion: 'vnext-audio-v1',
    digestPolicyVersion: USER_AUDIO_DIGEST_POLICY,
    engine: USER_AUDIO_ENGINE,
    sourceAudioFile: input.sourceStorageKey,
    sourceAudioSha256: `sha256:${input.sourceContentHash}`,
    units,
    totalMs: units.reduce((total, unit) => total + unit.durationMs, 0),
    alignmentReport: {
      policy: 'unit-files',
      scriptCoverage: 1,
      continuousCoverage: true,
      lowConfidenceUnitIds: [],
    },
  })

  return {
    audioManifest,
    audioAllocation: buildMeasuredAudioAllocation(scriptUnits, audioManifest),
  }
}
