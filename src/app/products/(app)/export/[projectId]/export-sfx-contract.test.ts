import { describe, expect, it } from 'vitest'
import { parseExportArtifactSoundEffects } from './export-sfx-contract'

const HASH = 'a'.repeat(64)

describe('parseExportArtifactSoundEffects', () => {
  it.each([
    {
      status: 'applied',
      mode: 'procedural',
      cueCount: 1,
      timingHash: HASH,
      cuePlanHash: HASH,
      waveformHashes: [HASH],
    },
    {
      status: 'omitted-off',
      mode: 'off',
      cueCount: 0,
      timingHash: null,
      cuePlanHash: null,
      waveformHashes: [],
    },
    {
      status: 'omitted-no-cues',
      mode: 'procedural',
      cueCount: 0,
      timingHash: HASH,
      cuePlanHash: HASH,
      waveformHashes: [],
    },
    {
      status: 'omitted-unsupported',
      mode: 'procedural',
      cueCount: 0,
      timingHash: null,
      cuePlanHash: null,
      waveformHashes: [],
    },
    {
      status: 'omitted-error',
      mode: 'procedural',
      cueCount: 0,
      timingHash: null,
      cuePlanHash: null,
      waveformHashes: [],
      failureCode: 'PROCEDURAL_SFX_MIX_FAILED',
    },
  ])('accepts the coherent $status contract', (value) => {
    expect(parseExportArtifactSoundEffects({
      generatorVersion: 'procedural-sfx/1.0.0',
      ...value,
    })).toMatchObject(value)
  })

  it.each([
    { status: 'applied', mode: 'procedural', cueCount: 0, timingHash: HASH, cuePlanHash: HASH, waveformHashes: [] },
    { status: 'applied', mode: 'procedural', cueCount: 1, timingHash: null, cuePlanHash: HASH, waveformHashes: [HASH] },
    { status: 'applied', mode: 'procedural', cueCount: 2, timingHash: HASH, cuePlanHash: HASH, waveformHashes: [HASH] },
    { status: 'applied', mode: 'procedural', cueCount: 1, timingHash: HASH, cuePlanHash: HASH, waveformHashes: [HASH], failureCode: 'PROCEDURAL_SFX_MIX_FAILED' },
    { status: 'omitted-off', mode: 'procedural', cueCount: 0, timingHash: null, cuePlanHash: null, waveformHashes: [] },
    { status: 'omitted-off', mode: 'off', cueCount: 0, timingHash: HASH, cuePlanHash: null, waveformHashes: [] },
    { status: 'omitted-error', mode: 'procedural', cueCount: 0, timingHash: null, cuePlanHash: null, waveformHashes: [] },
  ])('rejects a contradictory cross-field contract %#', (value) => {
    expect(parseExportArtifactSoundEffects({
      generatorVersion: 'procedural-sfx/1.0.0',
      ...value,
    })).toBeNull()
  })
})
