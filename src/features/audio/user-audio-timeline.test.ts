import { describe, expect, it } from 'vitest'
import type { MeasuredAudio } from './measure'
import { buildUserAudioTimeline } from './user-audio-timeline'

function measured(durationMs: number, sampleRateHz = 16_000): MeasuredAudio {
  return {
    sampleCount: Math.round((durationMs * sampleRateHz) / 1_000),
    sampleRateHz,
    durationMs,
    container: 'wav',
  }
}

describe('buildUserAudioTimeline', () => {
  it('merges ordered captions into stable scene-sized units', () => {
    const timeline = buildUserAudioTimeline({
      transcript: '一二三四五六',
      captions: [
        { text: '一', startMs: 0, endMs: 3_000 },
        { text: '二', startMs: 3_000, endMs: 6_000 },
        { text: '三', startMs: 6_000, endMs: 9_000 },
        { text: '四', startMs: 9_000, endMs: 12_000 },
        { text: '五', startMs: 12_000, endMs: 15_000 },
        { text: '六', startMs: 15_000, endMs: 18_000 },
      ],
      measured: measured(18_000),
    })

    expect(timeline.alignmentMode).toBe('caption-timestamps')
    expect(timeline.scriptUnits).toEqual([
      { unitId: 'U001', text: '一二三', order: 0 },
      { unitId: 'U002', text: '四五六', order: 1 },
    ])
    expect(timeline.slices).toEqual([
      {
        unitId: 'U001',
        startSample: 0,
        endSample: 144_000,
        sourceStartMs: 0,
        sourceEndMs: 9_000,
      },
      {
        unitId: 'U002',
        startSample: 144_000,
        endSample: 288_000,
        sourceStartMs: 9_000,
        sourceEndMs: 18_000,
      },
    ])
  })

  it('merges a zero-duration boundary token without discarding valid timestamps', () => {
    const transcript = '一二边三四五六'
    const timeline = buildUserAudioTimeline({
      transcript,
      captions: [
        { text: '一', startMs: 0, endMs: 3_000 },
        { text: '二', startMs: 3_000, endMs: 6_000 },
        { text: '边', startMs: 6_000, endMs: 6_000 },
        { text: '三', startMs: 6_000, endMs: 9_000 },
        { text: '四', startMs: 9_000, endMs: 12_000 },
        { text: '五', startMs: 12_000, endMs: 15_000 },
        { text: '六', startMs: 15_000, endMs: 18_000 },
      ],
      measured: measured(18_000),
    })

    expect(timeline.alignmentMode).toBe('caption-timestamps')
    expect(timeline.scriptUnits).toEqual([
      { unitId: 'U001', text: '一二边三', order: 0 },
      { unitId: 'U002', text: '四五六', order: 1 },
    ])
    expect(timeline.scriptUnits.map((unit) => unit.text).join('')).toBe(transcript)
    expectContinuousCoverage(timeline.slices, 288_000)
  })

  it('uses a long natural pause as a boundary while covering leading and trailing audio', () => {
    const timeline = buildUserAudioTimeline({
      transcript: '甲乙丙丁',
      captions: [
        { text: '甲', startMs: 500, endMs: 3_000 },
        { text: '乙', startMs: 3_000, endMs: 6_000 },
        { text: '丙', startMs: 9_000, endMs: 12_000 },
        { text: '丁', startMs: 12_000, endMs: 15_000 },
      ],
      measured: measured(16_000),
    })

    expect(timeline.scriptUnits.map((unit) => unit.text)).toEqual(['甲乙', '丙丁'])
    expect(timeline.slices).toEqual([
      expect.objectContaining({ startSample: 0, endSample: 120_000 }),
      expect.objectContaining({ startSample: 120_000, endSample: 256_000 }),
    ])
    expectContinuousCoverage(timeline.slices, 256_000)
  })

  it('keeps timestamp-based units below the 24 second hard limit', () => {
    const captions = Array.from({ length: 12 }, (_, index) => ({
      text: String(index + 1),
      startMs: index * 3_000,
      endMs: (index + 1) * 3_000,
    }))
    const timeline = buildUserAudioTimeline({
      transcript: captions.map((caption) => caption.text).join(''),
      captions,
      measured: measured(36_000),
    })

    expect(timeline.slices.length).toBeGreaterThan(1)
    for (const slice of timeline.slices) {
      expect(slice.sourceEndMs - slice.sourceStartMs).toBeLessThanOrEqual(24_000)
    }
    expectContinuousCoverage(timeline.slices, 576_000)
    expect(timeline.scriptUnits.map((unit) => unit.text).join('')).toBe(
      captions.map((caption) => caption.text).join('')
    )
  })

  it('falls back when leading silence would make a timestamp slice exceed 24 seconds', () => {
    const timeline = buildUserAudioTimeline({
      transcript: '很晚才开始',
      captions: [{ text: '很晚才开始', startMs: 30_000, endMs: 31_000 }],
      measured: measured(31_000),
    })

    expect(timeline.alignmentMode).toBe('whole-recording')
    expect(timeline.slices).toEqual([
      expect.objectContaining({
        startSample: 0,
        endSample: 496_000,
        sourceEndMs: 31_000,
      }),
    ])
  })

  it.each([
    {
      name: 'missing timestamps',
      captions: [] as Array<{ text: string; startMs: number; endMs: number }>,
    },
    {
      name: 'overlapping timestamps',
      captions: [
        { text: '重', startMs: 0, endMs: 2_000 },
        { text: '叠', startMs: 1_000, endMs: 3_000 },
      ],
    },
    {
      name: 'timestamp outside measured audio',
      captions: [{ text: '越界', startMs: 0, endMs: 10_001 }],
    },
  ])('falls back to one full recording unit for $name', ({ captions }) => {
    const timeline = buildUserAudioTimeline({
      transcript: '完整录音稿',
      captions,
      measured: measured(10_000),
    })

    expect(timeline).toEqual({
      alignmentMode: 'whole-recording',
      scriptUnits: [{ unitId: 'U001', text: '完整录音稿', order: 0 }],
      slices: [
        {
          unitId: 'U001',
          startSample: 0,
          endSample: 160_000,
          sourceStartMs: 0,
          sourceEndMs: 10_000,
        },
      ],
    })
  })

  it('rejects missing transcript text instead of inventing a script unit', () => {
    expect(() =>
      buildUserAudioTimeline({
        transcript: '   ',
        captions: [],
        measured: measured(1_000),
      })
    ).toThrow('录音转写文本为空')
  })
})

function expectContinuousCoverage(
  slices: ReadonlyArray<{ startSample: number; endSample: number }>,
  sampleCount: number
): void {
  expect(slices[0]?.startSample).toBe(0)
  expect(slices.at(-1)?.endSample).toBe(sampleCount)
  for (let index = 1; index < slices.length; index += 1) {
    expect(slices[index]?.startSample).toBe(slices[index - 1]?.endSample)
  }
}
