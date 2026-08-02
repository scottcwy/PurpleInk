import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import type { MediaAssemblyPlan } from './media-assembly'
import type { ConcatExportResult, LocalMediaPaths } from './concat'
import type { RenderExportPlan } from './repository'
import {
  exportDegradedProject,
  isDegradable,
  resolveDegradedPlan,
} from './export-degraded'

vi.mock('server-only', () => ({}))
vi.mock('./placeholder-clip', () => ({
  generatePlaceholderVideo: vi.fn(async (input: { laneKey: string }) => ({
    artifactId: `placeholder-video:${input.laneKey}`,
    storageKey: `ph/${input.laneKey}.mp4`,
    contentHash: 'v'.repeat(64),
  })),
  generatePlaceholderNarration: vi.fn(async (input: { laneKey: string }) => ({
    artifactId: `placeholder-narration:${input.laneKey}`,
    storageKey: `ph/${input.laneKey}.wav`,
    contentHash: 'a'.repeat(64),
  })),
}))

const RESOLUTION = { width: 1920, height: 1080 }
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000001'

function plan(overrides: Partial<RenderExportPlan> = {}): RenderExportPlan {
  return {
    incompleteNodeIds: [],
    shots: [],
    musicKey: null,
    subtitles: 'burn-in',
    soundEffects: 'off',
    targetResolution: RESOLUTION,
    resolutionPreset: '1920x1080',
    shotQa: {},
    waivedQaLanes: [],
    mediaAssemblyPlan: null,
    blockingIssues: [],
    placeholderCandidates: [],
    placeholderLaneKeys: [],
    fps: 30,
    timeline: { fps: 30, totalFrames: 0, shots: [] },
    media: {
      narrationReadyCount: 0,
      subtitleReadyCount: 0,
      requiredShotCount: 0,
      delivery: 'narration-hard-subtitle-v2',
    },
    ...overrides,
  }
}

describe('isDegradable', () => {
  it('is false when a project-level integrity issue blocks occupancy', () => {
    expect(
      isDegradable(
        plan({ blockingIssues: [{ laneKey: null, kind: 'render', code: 'artifact-invalid' }] })
      )
    ).toBe(false)
  })

  it('is false when the ingest audio contract (fps) is missing', () => {
    expect(isDegradable(plan({ fps: null }))).toBe(false)
  })

  it('is true when only per-lane issues remain', () => {
    expect(
      isDegradable(
        plan({ blockingIssues: [{ laneKey: 'S007', kind: 'render', code: 'artifact-missing' }] })
      )
    ).toBe(true)
  })
})

describe('resolveDegradedPlan', () => {
  it('generates placeholders for candidates then re-assembles with them', async () => {
    const assembled = plan({
      mediaAssemblyPlan: assemblyPlan(),
      placeholderLaneKeys: ['S007'],
    })
    const getExportPlan = vi
      .fn()
      .mockResolvedValueOnce(
        plan({
          placeholderCandidates: [
            { laneKey: 'S007', durationInFrames: 60, audioUnitId: 'U007', needsVideo: true, needsNarration: false },
          ],
        })
      )
      .mockResolvedValueOnce(assembled)

    const result = await resolveDegradedPlan('p1', {
      repository: { getExportPlan },
      storage: createStorage(),
    })

    expect(result.degradable).toBe(true)
    expect(result.placeholderLanes).toEqual(['S007'])
    // 第二趟带占位 map 调用。
    expect(getExportPlan.mock.calls[1]?.[1]).toMatchObject({ degraded: true })
    const secondCall = getExportPlan.mock.calls[1]?.[1] as {
      placeholderVideos: Map<string, unknown>
    }
    expect(secondCall.placeholderVideos.get('S007')).toBeDefined()
  })

  it('refuses when a project-level issue makes the project non-degradable', async () => {
    const getExportPlan = vi.fn(async () =>
      plan({ blockingIssues: [{ laneKey: null, kind: 'render', code: 'artifact-invalid' }] })
    )

    const result = await resolveDegradedPlan('p1', {
      repository: { getExportPlan },
      storage: createStorage(),
    })

    expect(result.degradable).toBe(false)
    expect(result.plan).toBeNull()
    expect(getExportPlan).toHaveBeenCalledTimes(1)
  })
})

describe('exportDegradedProject', () => {
  it('concats the degraded plan and registers final + manifest with matching hash', async () => {
    const mediaAssembly = {
      ...assemblyPlan(),
      musicKey: 'music/degraded.mp3',
    }
    const assembled = plan({
      mediaAssemblyPlan: mediaAssembly,
      placeholderLaneKeys: ['S007'],
    })
    const getExportPlan = vi
      .fn()
      .mockResolvedValueOnce(
        plan({
          waivedQaLanes: ['S004'],
          placeholderCandidates: [
            { laneKey: 'S007', durationInFrames: 60, audioUnitId: 'U007', needsVideo: true, needsNarration: false },
          ],
        })
      )
      .mockResolvedValueOnce(assembled)
    const registerFinalDelivery = vi.fn(async () =>
      finalDelivery('artifact-final')
    )
    const puts: Array<{ key: string; bytes: Buffer }> = []
    const storage = createStorage()
    vi.mocked(storage.put).mockImplementation(async (key, data) => {
      puts.push({ key, bytes: data as Buffer })
      return key
    })
    vi.mocked(storage.readLocalFile).mockResolvedValue(Buffer.from('final-mp4-bytes'))
    const concat = vi.fn(async (
      _plan: MediaAssemblyPlan,
      _paths: LocalMediaPaths,
      _subtitleAss: string | null,
      _outputPath: string,
    ) => successfulConcat('/tmp/final.mp4'))

    const result = await exportDegradedProject('p1', ATTEMPT_ID, {
      repository: { getExportPlan, registerFinalDelivery },
      storage,
      concat,
    })

    expect(result).toMatchObject({
      ok: true,
      placeholderLanes: ['S007'],
      waivedQaLanes: ['S004'],
    })
    expect(concat.mock.calls[0]?.[1]).toEqual({
      videoPaths: ['/local/ph/S007.mp4'],
      narrationPaths: ['/local/audio/U007.mp3'],
      musicPath: '/local/music/degraded.mp3',
    })
    expect(
      vi.mocked(storage.materializeLocalPath).mock.calls.map(([key]) => key),
    ).toEqual([
      'ph/S007.mp4',
      'ph/S007.mp4',
      'audio/U007.mp3',
      'music/degraded.mp3',
    ])
    expect(registerFinalDelivery).toHaveBeenCalledOnce()
    expect(registerFinalDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ATTEMPT_ID,
        degradedManifest: expect.any(Object),
        soundEffectsManifest: expect.any(Object),
      })
    )
    // 清单字节含与成片一致的 finalContentHash。
    const manifestPut = puts.find((entry) => entry.key.endsWith('.degraded.json'))
    const manifest = JSON.parse(manifestPut!.bytes.toString('utf-8')) as {
      schemaVersion: number
      deliveryMode: string
      finalContentHash: string
      confirmationFingerprint: string | null
      placeholderLanes: string[]
      waivedQaLanes: string[]
    }
    if (result.ok) {
      expect(manifest.finalContentHash).toBe(result.contentHash)
    }
    expect(manifest.placeholderLanes).toEqual(['S007'])
    expect(manifest.waivedQaLanes).toEqual(['S004'])
    expect(manifest.schemaVersion).toBe(3)
    expect(manifest.deliveryMode).toBe('degraded')
    expect(manifest.confirmationFingerprint).toBeNull()
  })

  it('records a QA-only waiver as degraded even when no placeholder is needed', async () => {
    const getExportPlan = vi
      .fn()
      .mockResolvedValueOnce(
        plan({
          incompleteNodeIds: ['qa-S004'],
          waivedQaLanes: ['S004'],
          mediaAssemblyPlan: assemblyPlan(),
        })
      )
      .mockResolvedValueOnce(
        plan({
          incompleteNodeIds: ['qa-S004'],
          waivedQaLanes: ['S004'],
          mediaAssemblyPlan: assemblyPlan(),
        })
      )
    const storage = createStorage()
    vi.mocked(storage.readLocalFile).mockResolvedValue(Buffer.from('final-mp4-bytes'))

    const result = await exportDegradedProject('p1', ATTEMPT_ID, {
      repository: {
        getExportPlan,
        registerFinalDelivery: vi.fn(async () => finalDelivery('final')),
      },
      storage,
      concat: vi.fn(async () => successfulConcat('/tmp/final.mp4')),
    })

    expect(result).toMatchObject({
      ok: true,
      placeholderLanes: [],
      waivedQaLanes: ['S004'],
    })
  })

  it('returns blocking issues without concat when not degradable', async () => {
    const getExportPlan = vi.fn(async () =>
      plan({ blockingIssues: [{ laneKey: null, kind: 'render', code: 'artifact-invalid' }] })
    )
    const concat = vi.fn()

    const result = await exportDegradedProject('p1', ATTEMPT_ID, {
      repository: {
        getExportPlan,
        registerFinalDelivery: vi.fn(async () => finalDelivery('x')),
      },
      storage: createStorage(),
      concat: concat as never,
    })

    expect(result.ok).toBe(false)
    expect(concat).not.toHaveBeenCalled()
  })

  it('removes the stored MP4 when degraded-manifest storage fails', async () => {
    const assembled = plan({
      mediaAssemblyPlan: assemblyPlan(),
      placeholderLaneKeys: [],
      waivedQaLanes: ['S004'],
    })
    const getExportPlan = vi
      .fn()
      .mockResolvedValueOnce(assembled)
      .mockResolvedValueOnce(assembled)
    const storage = createStorage()
    vi.mocked(storage.readLocalFile).mockResolvedValue(
      Buffer.from('final-mp4-bytes')
    )
    vi.mocked(storage.put)
      .mockResolvedValueOnce('exports/p1/final.mp4')
      .mockRejectedValueOnce(new Error('manifest storage failed'))

    await expect(
      exportDegradedProject('p1', ATTEMPT_ID, {
        repository: {
          getExportPlan,
          registerFinalDelivery: vi.fn(async () => finalDelivery('final')),
        },
        storage,
        concat: vi.fn(async () => successfulConcat('/tmp/final.mp4')),
      })
    ).rejects.toThrow('manifest storage failed')

    expect(storage.delete).toHaveBeenCalledWith('exports/p1/final.mp4')
  })
})

function assemblyPlan(): MediaAssemblyPlan {
  return {
    fps: 30,
    totalFrames: 60,
    shots: [
      {
        laneKey: 'S007',
        video: { artifactId: 'ph', storageKey: 'ph/S007.mp4', contentHash: 'v'.repeat(64) },
        durationInFrames: 60,
        narration: {
          unitId: 'U007',
          artifact: { artifactId: 'n', storageKey: 'audio/U007.mp3', contentHash: 'n'.repeat(64) },
          startInUnitMs: 0,
          endInUnitMs: 2_000,
        },
        subtitle: null,
      },
    ],
    targetResolution: RESOLUTION,
    musicKey: null,
    subtitles: 'burn-in',
    soundEffects: 'off',
  }
}

function successfulConcat(outputPath: string): ConcatExportResult {
  return {
    outputPath,
    soundEffects: {
      mode: 'off',
      status: 'omitted-off',
      generatorVersion: 'procedural-sfx/1.0.0',
      cueCount: 0,
      timingHash: null,
      cuePlanHash: null,
      waveformHashes: [],
    },
  }
}

function finalDelivery(finalArtifactId: string) {
  return {
    finalArtifactId,
    soundEffectsManifestArtifactId: 'artifact-sfx',
    degradedManifestArtifactId: 'artifact-degraded',
  }
}

function createStorage(): StorageAdapter {
  return {
    put: vi.fn(async (key: string) => key),
    get: vi.fn(),
    exists: vi.fn(),
    localPath: vi.fn(() => {
      throw new Error('direct localPath must not be used')
    }),
    materializeLocalPath: vi.fn(async (key: string) => `/local/${key}`),
    delete: vi.fn(async () => {}),
    tempDir: vi.fn(async () => '/tmp/work'),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(async () => {}),
  }
}
