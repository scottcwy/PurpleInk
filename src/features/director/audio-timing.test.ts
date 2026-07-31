import { describe, expect, it } from 'vitest'
import type { NarrationResult } from '@/features/audio'
import {
  buildMeasuredAudioAllocation,
  buildMeasuredAudioManifest,
} from './audio-timing'

const scriptUnits = [
  { unitId: 'U001', text: '十个字的短句。' },
  {
    unitId: 'U002',
    text: '这是一段明显更长的旁白文本，用来验证时长与帧数会随真实语音变化。',
  },
]

function narration(overrides: Partial<NarrationResult> = {}): NarrationResult {
  return {
    engine: 'stepaudio-2.5-tts',
    voice: 'cixingnansheng',
    units: [
      {
        unitId: 'U001',
        text: scriptUnits[0]!.text,
        audioKey: 'narration/project-1/aaa.mp3',
        audioArtifactId: 'artifact-1',
        contentHash: 'a'.repeat(64),
        durationMs: 1583.375,
        sampleRateHz: 24_000,
        sampleCount: 38_001,
        nativeCaptions: [],
        reused: false,
      },
      {
        unitId: 'U002',
        text: scriptUnits[1]!.text,
        audioKey: 'narration/project-1/bbb.mp3',
        audioArtifactId: 'artifact-2',
        contentHash: 'b'.repeat(64),
        durationMs: 7216.5,
        sampleRateHz: 24_000,
        sampleCount: 173_196,
        nativeCaptions: [],
        reused: false,
      },
    ],
    ...overrides,
  }
}

describe('buildMeasuredAudioManifest', () => {
  it('records the real engine, real audio keys and measured durations', () => {
    const manifest = buildMeasuredAudioManifest(scriptUnits, narration())

    expect(manifest.engine).toBe('stepaudio-2.5-tts')
    expect(manifest.contractVersion).toBe('vnext-audio-v1')
    expect(manifest.units[0]).toMatchObject({
      audioFile: 'narration/project-1/aaa.mp3',
      durationMs: 1583.375,
      sampleRateHz: 24_000,
      sampleCount: 38_001,
      sha256: `sha256:${'a'.repeat(64)}`,
      alignment: { mode: 'unit-file', coverage: 1 },
    })
    expect(manifest.totalMs).toBeCloseTo(1583.375 + 7216.5, 6)
    expect(manifest.alignmentReport).toEqual({
      policy: 'unit-files',
      scriptCoverage: 1,
      continuousCoverage: true,
      lowConfidenceUnitIds: [],
    })
  })

  it('refuses narration that does not match the committed script units', () => {
    const drifted = narration()
    drifted.units[1] = { ...drifted.units[1]!, text: '被改写的文本' }

    expect(() => buildMeasuredAudioManifest(scriptUnits, drifted)).toThrow(
      '与 script unit 不一致'
    )
    expect(() =>
      buildMeasuredAudioManifest(scriptUnits, {
        ...narration(),
        units: [narration().units[0]!],
      })
    ).toThrow('缺少 U002 的实测旁白音频')
  })

  it('promotes ordered native TTS timestamps into script/sample anchors', () => {
    const withNative = narration()
    withNative.units[0] = {
      ...withNative.units[0]!,
      nativeCaptions: [
        { text: '十个字', startMs: 0, endMs: 500 },
        { text: '的短句。', startMs: 500, endMs: 1_500 },
      ],
    }

    const manifest = buildMeasuredAudioManifest(scriptUnits, withNative)

    expect(manifest.units[0]).toMatchObject({
      alignment: { mode: 'tts-native', coverage: 1 },
      anchors: [
        {
          startChar: 0,
          endChar: 3,
          startSample: 0,
          endSample: 12_000,
          confidence: 1,
        },
        {
          startChar: 3,
          endChar: 7,
          startSample: 12_000,
          endSample: 36_000,
          confidence: 1,
        },
      ],
    })
  })

  it('keeps the unit-file fallback when native TTS text is out of order', () => {
    const drifted = narration()
    drifted.units[0] = {
      ...drifted.units[0]!,
      nativeCaptions: [
        { text: '短句', startMs: 0, endMs: 500 },
        { text: '十个字', startMs: 500, endMs: 1_000 },
      ],
    }

    const unit = buildMeasuredAudioManifest(scriptUnits, drifted).units[0]!
    expect(unit).toMatchObject({ alignment: { mode: 'unit-file' } })
    expect('anchors' in unit).toBe(false)
  })
})

describe('buildMeasuredAudioAllocation', () => {
  it('derives different frame counts for different narration lengths', () => {
    const manifest = buildMeasuredAudioManifest(scriptUnits, narration())

    const allocation = buildMeasuredAudioAllocation(scriptUnits, manifest)

    expect(allocation.fps).toBe(30)
    expect(allocation.shots[0]).toMatchObject({
      id: 'S001',
      audioUnitId: 'U001',
      startInUnitMs: 0,
      endInUnitMs: 1583.375,
      startSample: 0,
      endSample: 38_001,
      durationInFrames: 48, // ceil(1583.375 * 30 / 1000)
      allocationMethod: 'unit-boundary',
    })
    expect(allocation.shots[1]).toMatchObject({
      id: 'S002',
      durationInFrames: 217, // ceil(7216.5 * 30 / 1000)
    })
    expect(allocation.totalFrames).toBe(48 + 217)
    expect(allocation.shots[0]?.substring).toBe(scriptUnits[0]!.text)
  })

  it('covers the whole narration at 24 and 60 fps as well', () => {
    const manifest = buildMeasuredAudioManifest(scriptUnits, narration())

    for (const fps of [24, 60] as const) {
      const allocation = buildMeasuredAudioAllocation(scriptUnits, manifest, fps)
      allocation.shots.forEach((shot) => {
        expect((shot.durationInFrames * 1000) / fps).toBeGreaterThanOrEqual(
          shot.endInUnitMs
        )
      })
    }
  })
})
