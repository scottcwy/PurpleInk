import { describe, expect, it } from 'vitest'
import {
  audioAllocationSchema,
  audioManifestSchema,
  scriptUnitsSchema,
} from './ingest'

const digest = `sha256:${'a'.repeat(64)}`

describe('ingest schemas', () => {
  it('parses script units, audio manifest, and audio allocation examples', () => {
    expect(scriptUnitsSchema.parse([{ unitId: 'U001', text: '第一句', order: 0 }])).toHaveLength(1)
    expect(
      audioManifestSchema.parse({
        version: 1,
        contractVersion: 'legacy-v2',
        engine: 'stepfun-tts',
        units: [
          {
            unitId: 'U001',
            text: '第一句',
            audioFile: 'audio/U001.wav',
            durationMs: 1200,
            source: 'tts',
          },
        ],
        totalMs: 1200,
      }).totalMs
    ).toBe(1200)
    expect(audioAllocationSchema.parse(validAllocation()).shots[0]?.id).toBe('S001')
  })

  it('reports a missing required allocation field precisely', () => {
    const input = validAllocation()
    delete (input.shots[0] as Record<string, unknown>).endSample

    const result = audioAllocationSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['shots', 0, 'endSample'])
    }
  })
})

function validAllocation() {
  return {
    schemaVersion: 1 as const,
    inputDigests: {
      audioManifest: digest,
      runtimeBindings: digest,
      scriptUnits: digest,
    },
    fps: 30 as const,
    shots: [
      {
        id: 'S001',
        audioUnitId: 'U001',
        scriptRange: { startChar: 0, endChar: 3 },
        substring: '第一句',
        startInUnitMs: 0,
        endInUnitMs: 1200,
        startSample: 0,
        endSample: 57600,
        durationInFrames: 36,
        allocationMethod: 'character-anchor',
      },
    ],
    totalFrames: 36,
  }
}
