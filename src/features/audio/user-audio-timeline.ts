import type { MeasuredAudio } from './measure'
import type { Caption } from './types'

const TARGET_MIN_MS = 8_000
const TARGET_MAX_MS = 10_000
const HARD_MAX_MS = 24_000
const NATURAL_PAUSE_MS = 2_000

export interface UserRecordingScriptUnit {
  unitId: string
  text: string
  order: number
}

export interface UserAudioSlicePlan {
  unitId: string
  startSample: number
  endSample: number
  sourceStartMs: number
  sourceEndMs: number
}

export interface UserAudioTimeline {
  alignmentMode: 'caption-timestamps' | 'whole-recording'
  scriptUnits: UserRecordingScriptUnit[]
  slices: UserAudioSlicePlan[]
}

export interface UserAudioTimelineInput {
  transcript: string
  captions: readonly Caption[]
  measured: MeasuredAudio
}

interface CaptionGroup {
  captions: Caption[]
}

/**
 * 把 ASR 时间戳投影成稳定的 script units 与连续采样边界。
 *
 * 时间戳只在整组都单调、有效且落在实测音频内时使用；任何歧义都降级为一个
 * 全长 unit，避免丢字、重叠或用猜测的时长切坏用户原录音。
 */
export function buildUserAudioTimeline(
  input: UserAudioTimelineInput
): UserAudioTimeline {
  const transcript = input.transcript.trim()
  if (!transcript) throw new Error('录音转写文本为空，无法建立时间轴')
  const durationMs = validateMeasured(input.measured)
  const captions = input.captions.filter((caption) => caption.text.trim().length > 0)
  if (!hasUsableTimeline(captions, durationMs)) {
    return wholeRecording(transcript, input.measured)
  }

  const groups = groupCaptions(captions)
  if (groups.length > input.measured.sampleCount) {
    return wholeRecording(transcript, input.measured)
  }
  const boundaries = sampleBoundaries(groups, input.measured)
  const scriptUnits = groups.map((group, index) => ({
    unitId: unitIdFor(index),
    text: group.captions.map((caption) => caption.text).join('').trim(),
    order: index,
  }))
  const slices = groups.map((_, index) => {
    const startSample = boundaries[index]!
    const endSample = boundaries[index + 1]!
    return {
      unitId: unitIdFor(index),
      startSample,
      endSample,
      sourceStartMs: samplesToMs(startSample, input.measured.sampleRateHz),
      sourceEndMs: samplesToMs(endSample, input.measured.sampleRateHz),
    }
  })
  if (
    slices.some(
      (slice) => slice.sourceEndMs - slice.sourceStartMs > HARD_MAX_MS
    )
  ) {
    return wholeRecording(transcript, input.measured)
  }
  return { alignmentMode: 'caption-timestamps', scriptUnits, slices }
}

function validateMeasured(measured: MeasuredAudio): number {
  if (
    !Number.isInteger(measured.sampleCount) ||
    measured.sampleCount <= 0 ||
    !Number.isInteger(measured.sampleRateHz) ||
    measured.sampleRateHz < 8_000 ||
    !Number.isFinite(measured.durationMs) ||
    measured.durationMs <= 0
  ) {
    throw new Error('实测音频元数据无效，无法建立时间轴')
  }
  const durationMs = samplesToMs(measured.sampleCount, measured.sampleRateHz)
  const toleranceMs = Math.max(1, 1_000 / measured.sampleRateHz)
  if (Math.abs(measured.durationMs - durationMs) > toleranceMs) {
    throw new Error('实测音频时长与采样数不一致')
  }
  return durationMs
}

function hasUsableTimeline(
  captions: readonly Caption[],
  durationMs: number
): boolean {
  if (captions.length === 0) return false
  let previousEndMs = 0
  for (const caption of captions) {
    if (
      !Number.isFinite(caption.startMs) ||
      !Number.isFinite(caption.endMs) ||
      caption.startMs < previousEndMs ||
      caption.startMs < 0 ||
      caption.endMs <= caption.startMs ||
      caption.endMs > durationMs ||
      caption.endMs - caption.startMs > HARD_MAX_MS
    ) {
      return false
    }
    previousEndMs = caption.endMs
  }
  return true
}

function groupCaptions(captions: readonly Caption[]): CaptionGroup[] {
  const groups: CaptionGroup[] = []
  let current: Caption[] = []
  for (const caption of captions) {
    if (current.length > 0 && shouldStartNextGroup(current, caption)) {
      groups.push({ captions: current })
      current = []
    }
    current.push(caption)
  }
  if (current.length > 0) groups.push({ captions: current })
  return groups
}

function shouldStartNextGroup(
  current: readonly Caption[],
  next: Caption
): boolean {
  const first = current[0]!
  const last = current[current.length - 1]!
  const currentMs = last.endMs - first.startMs
  const projectedMs = next.endMs - first.startMs
  const pauseMs = next.startMs - last.endMs
  if (pauseMs >= NATURAL_PAUSE_MS) return true
  if (projectedMs > HARD_MAX_MS) return true
  return currentMs >= TARGET_MIN_MS && projectedMs > TARGET_MAX_MS
}

function sampleBoundaries(
  groups: readonly CaptionGroup[],
  measured: MeasuredAudio
): number[] {
  const boundaries = [0]
  for (let index = 1; index < groups.length; index += 1) {
    const previous = groups[index - 1]!.captions
    const next = groups[index]!.captions
    const previousEndMs = previous[previous.length - 1]!.endMs
    const nextStartMs = next[0]!.startMs
    const midpointMs = previousEndMs + (nextStartMs - previousEndMs) / 2
    const proposed = Math.round((midpointMs * measured.sampleRateHz) / 1_000)
    const minimum = boundaries[index - 1]! + 1
    const maximum = measured.sampleCount - (groups.length - index)
    boundaries.push(Math.min(maximum, Math.max(minimum, proposed)))
  }
  boundaries.push(measured.sampleCount)
  return boundaries
}

function wholeRecording(
  transcript: string,
  measured: MeasuredAudio
): UserAudioTimeline {
  return {
    alignmentMode: 'whole-recording',
    scriptUnits: [{ unitId: 'U001', text: transcript, order: 0 }],
    slices: [
      {
        unitId: 'U001',
        startSample: 0,
        endSample: measured.sampleCount,
        sourceStartMs: 0,
        sourceEndMs: samplesToMs(measured.sampleCount, measured.sampleRateHz),
      },
    ],
  }
}

function unitIdFor(index: number): string {
  return `U${String(index + 1).padStart(3, '0')}`
}

function samplesToMs(samples: number, sampleRateHz: number): number {
  return (samples / sampleRateHz) * 1_000
}
