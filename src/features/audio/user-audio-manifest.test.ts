import { describe, expect, it } from 'vitest'
import { buildUserAudioContracts } from './user-audio-manifest'

const HASH = 'a'.repeat(64)

function contract(alignmentMode: 'caption-timestamps' | 'whole-recording') {
  return buildUserAudioContracts({
    scriptUnits: [{ unitId: 'U001', text: '完整录音稿', order: 0 }],
    sourceStorageKey: 'sources/user.wav',
    sourceContentHash: HASH,
    alignmentMode,
    slices: [
      {
        storageKey: 'cuts/U001.wav',
        slice: {
          unitId: 'U001',
          text: '完整录音稿',
          startSample: 0,
          endSample: 8_000,
          sourceStartMs: 0,
          sourceEndMs: 1_000,
          audioBytes: Buffer.from('wav'),
          contentHash: HASH,
          sizeBytes: 3,
          sampleRateHz: 8_000,
          sampleCount: 8_000,
          durationMs: 1_000,
        },
      },
    ],
  })
}

describe('buildUserAudioContracts alignment truth', () => {
  it('marks a no-timestamp whole recording as low-confidence alignment', () => {
    const result = contract('whole-recording')

    expect(result.audioManifest.units[0]?.alignment).toMatchObject({
      mode: 'unit-file',
      coverage: 1,
      confidence: 0,
      sourceStartSample: 0,
      sourceEndSample: 8_000,
    })
    expect(result.audioManifest.alignmentReport).toMatchObject({
      policy: 'unit-files',
      scriptCoverage: 1,
      continuousCoverage: true,
      lowConfidenceUnitIds: ['U001'],
    })
  })

  it('keeps timestamp-derived unit files high-confidence', () => {
    const result = contract('caption-timestamps')

    expect(result.audioManifest.units[0]?.alignment?.confidence).toBe(1)
    expect(result.audioManifest.alignmentReport?.lowConfidenceUnitIds).toEqual([])
  })
})
