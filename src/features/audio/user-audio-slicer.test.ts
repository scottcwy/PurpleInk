import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { readWavHeader } from './wav-header'
import { wavBytes } from './wav.fixture'
import type { MeasuredAudio } from './measure'
import { mp3Frames } from './mp3.fixture'
import type { UserAudioTimeline } from './user-audio-timeline'
import {
  decodeUserRecording,
  sliceDecodedUserRecording,
} from './user-audio-slicer'

vi.mock('server-only', () => ({}))

const measured: MeasuredAudio = {
  sampleCount: 16_000,
  sampleRateHz: 16_000,
  durationMs: 1_000,
  container: 'wav',
}

const timeline: UserAudioTimeline = {
  alignmentMode: 'caption-timestamps',
  scriptUnits: [
    { unitId: 'U001', text: '前半', order: 0 },
    { unitId: 'U002', text: '后半', order: 1 },
  ],
  slices: [
    {
      unitId: 'U001',
      startSample: 0,
      endSample: 8_000,
      sourceStartMs: 0,
      sourceEndMs: 500,
    },
    {
      unitId: 'U002',
      startSample: 8_000,
      endSample: 16_000,
      sourceStartMs: 500,
      sourceEndMs: 1_000,
    },
  ],
}

describe('user recording decode and slice', () => {
  it('decodes once and emits real content-addressed WAV bytes per unit', async () => {
    const source = wavBytes({ sampleRateHz: 16_000, sampleCount: 16_000 })
    const pcm = Buffer.alloc(32_000)
    for (let index = 0; index < 16_000; index += 1) {
      pcm.writeInt16LE(index % 30_000, index * 2)
    }
    const decode = vi.fn(async () => pcm)

    const decoded = await decodeUserRecording(source, decode)
    const slices = sliceDecodedUserRecording(decoded, timeline)

    expect(decode).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledWith(source, 16_000)
    expect(slices).toHaveLength(2)
    expect(slices[0]).toMatchObject({
      unitId: 'U001',
      sampleRateHz: 16_000,
      sampleCount: 8_000,
      durationMs: 500,
      sizeBytes: 16_044,
    })
    expect(slices[1]).toMatchObject({
      unitId: 'U002',
      sampleRateHz: 16_000,
      sampleCount: 8_000,
      durationMs: 500,
      sizeBytes: 16_044,
    })
    expect(slices[0]?.audioBytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(slices[0]?.audioBytes.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(readWavHeader(slices[0]!.audioBytes)).toMatchObject({
      sampleRateHz: 16_000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 16_000,
    })
    expect(slices[0]?.audioBytes.readInt16LE(44)).toBe(0)
    expect(slices[1]?.audioBytes.readInt16LE(44)).toBe(8_000)
    for (const slice of slices) {
      expect(slice.contentHash).toBe(
        createHash('sha256').update(slice.audioBytes).digest('hex')
      )
      expect(slice.sizeBytes).toBe(slice.audioBytes.length)
    }
  })

  it('uses bundled ffmpeg against actual WAV bytes', async () => {
    const source = wavBytes({ sampleRateHz: 16_000, sampleCount: 16_000, fill: 0 })
    const decoded = await decodeUserRecording(source)
    const slices = sliceDecodedUserRecording(decoded, timeline)

    expect(decoded.measured).toEqual(measured)
    expect(slices).toHaveLength(2)
    expect(slices.every((slice) => slice.audioBytes.length === 16_044)).toBe(true)
    expect(slices.every((slice) => readWavHeader(slice.audioBytes).channels === 1)).toBe(
      true
    )
  })

  it('derives MP3 duration from one decoded PCM result', async () => {
    const decode = vi.fn(async () => Buffer.alloc(64_000))
    const decoded = await decodeUserRecording(mp3Frames(3), decode)

    expect(decode).toHaveBeenCalledTimes(1)
    expect(decoded.measured).toEqual({
      sampleCount: 32_000,
      sampleRateHz: 32_000,
      durationMs: 1_000,
      container: 'mp3',
    })
  })

  it('rejects impossible decoded PCM bytes', async () => {
    const source = wavBytes({ sampleRateHz: 16_000, sampleCount: 16_000 })

    await expect(
      decodeUserRecording(source, async () => Buffer.alloc(3))
    ).rejects.toThrow('PCM 字节数无效')
  })

  it('rejects a slice plan with a gap', async () => {
    const broken: UserAudioTimeline = {
      ...timeline,
      slices: [
        timeline.slices[0]!,
        { ...timeline.slices[1]!, startSample: 8_001 },
      ],
    }
    const decoded = {
      measured,
      pcmBytes: Buffer.alloc(32_000),
    }

    expect(() => sliceDecodedUserRecording(decoded, broken)).toThrow(
      '切片边界必须连续'
    )
  })
})
