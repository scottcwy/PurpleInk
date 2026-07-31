import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { LocalFsStorage } from '@/lib/storage/local-fs'
import type { MediaAssemblyPlan } from './media-assembly'
import {
  buildProceduralSfxManifestBytes,
  parseProceduralSfxManifestForFinal,
  proceduralSfxPlanFingerprintFacts,
  readBoundProceduralSfxManifest,
  storeProceduralSfxManifest,
} from './procedural-sfx-manifest'

const ATTEMPT_ID = '00000000-0000-4000-8000-000000000001'
const FINAL_HASH = 'a'.repeat(64)

describe('procedural SFX delivery facts', () => {
  it('projects generator, timing and cue-plan hashes for export idempotency', () => {
    const facts = proceduralSfxPlanFingerprintFacts(plan('procedural'))

    expect(facts).toMatchObject({
      mode: 'procedural',
      generatorVersion: 'procedural-sfx/1.0.0',
      cueCount: 2,
    })
    expect(facts.timingHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(facts.cuePlanHash).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('keeps the disabled path explicit without inventing timing or cues', () => {
    expect(proceduralSfxPlanFingerprintFacts(plan('off'))).toEqual({
      mode: 'off',
      generatorVersion: 'procedural-sfx/1.0.0',
      cueCount: 0,
      timingHash: null,
      cuePlanHash: null,
    })
  })
})

describe('procedural SFX manifest', () => {
  it('round-trips only for the exact final MP4 attempt and content hash', () => {
    const bytes = buildProceduralSfxManifestBytes({
      attemptId: ATTEMPT_ID,
      finalContentHash: FINAL_HASH,
      soundEffects: {
        mode: 'procedural',
        status: 'applied',
        generatorVersion: 'procedural-sfx/1.0.0',
        cueCount: 1,
        timingHash: 'b'.repeat(64),
        cuePlanHash: 'c'.repeat(64),
        waveformHashes: ['d'.repeat(64)],
      },
    })

    expect(
      parseProceduralSfxManifestForFinal(bytes, {
        attemptId: ATTEMPT_ID,
        finalContentHash: FINAL_HASH,
      })
    ).toMatchObject({
      schemaVersion: 'cvc.procedural-sfx-manifest/v1',
      attemptId: ATTEMPT_ID,
      finalContentHash: FINAL_HASH,
      status: 'applied',
    })
    expect(
      parseProceduralSfxManifestForFinal(bytes, {
        attemptId: '00000000-0000-4000-8000-000000000002',
        finalContentHash: FINAL_HASH,
      })
    ).toBeNull()
    expect(
      parseProceduralSfxManifestForFinal(bytes, {
        attemptId: ATTEMPT_ID,
        finalContentHash: 'e'.repeat(64),
      })
    ).toBeNull()
  })

  it('records disabled and fallback outcomes without raw errors', () => {
    const bytes = buildProceduralSfxManifestBytes({
      attemptId: ATTEMPT_ID,
      finalContentHash: FINAL_HASH,
      soundEffects: {
        mode: 'procedural',
        status: 'omitted-error',
        generatorVersion: 'procedural-sfx/1.0.0',
        cueCount: 1,
        timingHash: 'b'.repeat(64),
        cuePlanHash: 'c'.repeat(64),
        waveformHashes: ['d'.repeat(64)],
        failureCode: 'PROCEDURAL_SFX_MIX_FAILED',
      },
    })
    const text = bytes.toString('utf-8')

    expect(text).toContain('"status":"omitted-error"')
    expect(text).toContain('"failureCode":"PROCEDURAL_SFX_MIX_FAILED"')
    expect(text).not.toContain('message')
    expect(text).not.toContain('path')
  })

  it.each([
    {
      name: 'applied with no cues',
      patch: { cueCount: 0, waveformHashes: [] },
    },
    {
      name: 'applied without plan hashes',
      patch: { timingHash: null, cuePlanHash: null },
    },
    {
      name: 'applied with fewer waveforms than cues',
      patch: { cueCount: 2, waveformHashes: ['d'.repeat(64)] },
    },
    {
      name: 'applied with a failure code',
      patch: { failureCode: 'PROCEDURAL_SFX_MIX_FAILED' },
    },
    {
      name: 'off with procedural mode',
      patch: { mode: 'procedural' },
      base: disabledManifest(),
    },
    {
      name: 'off with hashes',
      patch: { timingHash: 'b'.repeat(64) },
      base: disabledManifest(),
    },
    {
      name: 'error without safe failure code',
      patch: {},
      base: {
        ...appliedManifest(),
        status: 'omitted-error',
      },
    },
  ])('fails closed for a contradictory $name manifest', ({ patch, base }) => {
    const bytes = Buffer.from(JSON.stringify({
      schemaVersion: 'cvc.procedural-sfx-manifest/v1',
      attemptId: ATTEMPT_ID,
      finalContentHash: FINAL_HASH,
      ...(base ?? appliedManifest()),
      ...patch,
    }), 'utf-8')

    expect(
      parseProceduralSfxManifestForFinal(bytes, {
        attemptId: ATTEMPT_ID,
        finalContentHash: FINAL_HASH,
      })
    ).toBeNull()
  })

  it('writes real storage bytes whose SHA-256 matches the registered descriptor', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pi-sfx-manifest-'))
    try {
      const storage = new LocalFsStorage(root)
      const stored = await storeProceduralSfxManifest(storage, {
        projectId: 'project-1',
        attemptId: ATTEMPT_ID,
        finalContentHash: FINAL_HASH,
        soundEffects: {
          mode: 'off',
          status: 'omitted-off',
          generatorVersion: 'procedural-sfx/1.0.0',
          cueCount: 0,
          timingHash: null,
          cuePlanHash: null,
          waveformHashes: [],
        },
      })
      const bytes = await storage.get(stored.storageKey)

      expect(bytes.byteLength).toBe(stored.sizeBytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        stored.contentHash
      )
      expect(
        await readBoundProceduralSfxManifest(
          storage,
          {
            schemaVersion: 'cvc.procedural-sfx-manifest/v1',
            storageKey: stored.storageKey,
            contentHash: stored.contentHash,
            sizeBytes: stored.sizeBytes,
          },
          {
            attemptId: ATTEMPT_ID,
            finalContentHash: FINAL_HASH,
          }
        )
      ).toMatchObject({ status: 'omitted-off' })
      expect(
        await readBoundProceduralSfxManifest(
          storage,
          {
            schemaVersion: 'cvc.procedural-sfx-manifest/v1',
            storageKey: stored.storageKey,
            contentHash: 'f'.repeat(64),
            sizeBytes: stored.sizeBytes,
          },
          {
            attemptId: ATTEMPT_ID,
            finalContentHash: FINAL_HASH,
          }
        )
      ).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function appliedManifest() {
  return {
    mode: 'procedural',
    status: 'applied',
    generatorVersion: 'procedural-sfx/1.0.0',
    cueCount: 1,
    timingHash: 'b'.repeat(64),
    cuePlanHash: 'c'.repeat(64),
    waveformHashes: ['d'.repeat(64)],
  } as const
}

function disabledManifest() {
  return {
    mode: 'off',
    status: 'omitted-off',
    generatorVersion: 'procedural-sfx/1.0.0',
    cueCount: 0,
    timingHash: null,
    cuePlanHash: null,
    waveformHashes: [],
  } as const
}

function plan(soundEffects: 'off' | 'procedural'): MediaAssemblyPlan {
  return {
    fps: 30,
    totalFrames: 60,
    shots: ['S001', 'S002'].map((laneKey) => ({
      laneKey,
      video: {
        artifactId: `video-${laneKey}`,
        storageKey: `render/${laneKey}.mp4`,
        contentHash: '1'.repeat(64),
      },
      durationInFrames: 30,
      narration: {
        unitId: laneKey,
        artifact: {
          artifactId: `audio-${laneKey}`,
          storageKey: `audio/${laneKey}.wav`,
          contentHash: '2'.repeat(64),
        },
        startInUnitMs: 0,
        endInUnitMs: 1_000,
      },
      subtitle: null,
    })),
    targetResolution: { width: 1920, height: 1080 },
    musicKey: null,
    subtitles: 'off',
    soundEffects,
  }
}
