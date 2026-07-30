import 'server-only'
import { createHash } from 'node:crypto'
import { readAudioStreamInfo } from './audio-format'
import {
  decodeMonoPcm,
  type DecodeMonoPcm,
  type MeasuredAudio,
} from './measure'
import type {
  UserAudioSlicePlan,
  UserAudioTimeline,
} from './user-audio-timeline'

const PCM_BYTES_PER_SAMPLE = 2
const WAV_HEADER_BYTES = 44

export interface UserRecordingAudioSlice extends UserAudioSlicePlan {
  text: string
  audioBytes: Buffer
  contentHash: string
  sizeBytes: number
  sampleRateHz: number
  sampleCount: number
  durationMs: number
}

export interface DecodedUserRecording {
  measured: MeasuredAudio
  pcmBytes: Buffer
}

/**
 * 用户原录音的唯一解码入口。队列可先用 measured.durationMs 完成 ASR 计费，
 * ASR 返回后继续复用 pcmBytes 切片，整条流程无需第二次解码。
 */
export async function decodeUserRecording(
  sourceBytes: Buffer,
  decode: DecodeMonoPcm = decodeMonoPcm
): Promise<DecodedUserRecording> {
  const stream = readAudioStreamInfo(sourceBytes)
  const pcmBytes = await decode(sourceBytes, stream.sampleRateHz)
  if (
    pcmBytes.length === 0 ||
    pcmBytes.length % PCM_BYTES_PER_SAMPLE !== 0
  ) {
    throw new Error(`解码得到的 PCM 字节数无效：${pcmBytes.length}`)
  }
  const sampleCount = pcmBytes.length / PCM_BYTES_PER_SAMPLE
  return {
    measured: {
      sampleCount,
      sampleRateHz: stream.sampleRateHz,
      durationMs: (sampleCount / stream.sampleRateHz) * 1_000,
      container: stream.container,
    },
    pcmBytes,
  }
}

/**
 * 按整数采样边界切分已解码的原录音。每段重新封装为真实 PCM WAV，hash 与
 * 大小都取最终字节；此函数没有 TTS 或媒体解码调用。
 */
export function sliceDecodedUserRecording(
  recording: DecodedUserRecording,
  timeline: UserAudioTimeline
): UserRecordingAudioSlice[] {
  const { measured, pcmBytes } = recording
  validatePlan(timeline, measured)
  if (pcmBytes.length % PCM_BYTES_PER_SAMPLE !== 0) {
    throw new Error(`解码得到的 PCM 字节数无效：${pcmBytes.length}`)
  }
  const decodedSampleCount = pcmBytes.length / PCM_BYTES_PER_SAMPLE
  if (decodedSampleCount !== measured.sampleCount) {
    throw new Error(
      `解码采样数与实测结果不一致：${decodedSampleCount} != ${measured.sampleCount}`
    )
  }

  return timeline.slices.map((plan, index) => {
    const unit = timeline.scriptUnits[index]!
    const sampleCount = plan.endSample - plan.startSample
    const pcmStart = plan.startSample * PCM_BYTES_PER_SAMPLE
    const pcmEnd = plan.endSample * PCM_BYTES_PER_SAMPLE
    const audioBytes = monoPcmWav(
      pcmBytes.subarray(pcmStart, pcmEnd),
      measured.sampleRateHz
    )
    return {
      ...plan,
      text: unit.text,
      audioBytes,
      contentHash: createHash('sha256').update(audioBytes).digest('hex'),
      sizeBytes: audioBytes.length,
      sampleRateHz: measured.sampleRateHz,
      sampleCount,
      durationMs: (sampleCount / measured.sampleRateHz) * 1_000,
    }
  })
}

function validatePlan(
  timeline: UserAudioTimeline,
  measured: MeasuredAudio
): void {
  if (
    timeline.slices.length === 0 ||
    timeline.slices.length !== timeline.scriptUnits.length
  ) {
    throw new Error('录音切片计划与 script units 数量不一致')
  }
  let previousEnd = 0
  const unitIds = new Set<string>()
  for (let index = 0; index < timeline.slices.length; index += 1) {
    const slice = timeline.slices[index]!
    const unit = timeline.scriptUnits[index]!
    if (slice.unitId !== unit.unitId || unitIds.has(unit.unitId)) {
      throw new Error('录音切片计划的 unitId 无法唯一对应 script unit')
    }
    unitIds.add(unit.unitId)
    if (
      !Number.isInteger(slice.startSample) ||
      !Number.isInteger(slice.endSample) ||
      slice.startSample !== previousEnd ||
      slice.endSample <= slice.startSample ||
      slice.endSample > measured.sampleCount
    ) {
      throw new Error('切片边界必须连续、非空且位于实测音频范围内')
    }
    previousEnd = slice.endSample
  }
  if (previousEnd !== measured.sampleCount) {
    throw new Error('切片边界必须覆盖完整实测音频')
  }
}

function monoPcmWav(pcm: Buffer, sampleRateHz: number): Buffer {
  const maximumDataBytes = 0xffff_ffff - 36
  if (pcm.length === 0 || pcm.length > maximumDataBytes || pcm.length % 2 !== 0) {
    throw new Error(`PCM 切片字节数无法封装为 WAV：${pcm.length}`)
  }
  const channels = 1
  const bitsPerSample = 16
  const blockAlign = (channels * bitsPerSample) / 8
  const header = Buffer.alloc(WAV_HEADER_BYTES)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRateHz, 24)
  header.writeUInt32LE(sampleRateHz * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
