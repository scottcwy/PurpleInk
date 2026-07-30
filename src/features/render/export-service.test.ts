import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import type { MediaAssemblyPlan } from './media-assembly'
import { getExportReadiness } from './export-readiness'
import { exportProject } from './export-service'
import type { FinalArtifactInput } from './render-artifact-repository'

vi.mock('server-only', () => ({}))

const directories: string[] = []

describe('exportProject', () => {
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('returns all incomplete ids without invoking concat', async () => {
    const concat = vi.fn()
    const result = await exportProject('project-1', {
      repository: {
        getExportPlan: vi.fn(async () => ({
          incompleteNodeIds: ['node-2', 'node-1'],
          shots: [],
          musicKey: null,
          subtitles: 'burn-in' as const,
          targetResolution: { width: 1920, height: 1080 },
          resolutionPreset: '1920x1080' as const,
          shotQa: {},
          ...mediaFields(null),
        })),
        registerFinalArtifact: vi.fn(async () => 'unused'),
      },
      storage: createStorage(),
      concat,
    })

    expect(result).toEqual({
      ok: false,
      incompleteNodeIds: ['node-1', 'node-2'],
    })
    expect(concat).not.toHaveBeenCalled()
  })

  it('refuses media-blocked plans without invoking ffmpeg', async () => {
    const concat = vi.fn()
    const blockingIssues = [
      {
        laneKey: 'S001',
        kind: 'subtitle' as const,
        code: 'artifact-invalid' as const,
      },
    ]
    const result = await exportProject('project-1', {
      repository: {
        getExportPlan: vi.fn(async () => ({
          incompleteNodeIds: [],
          shots: [],
          musicKey: null,
          subtitles: 'burn-in' as const,
          targetResolution: { width: 1920, height: 1080 },
          resolutionPreset: '1920x1080' as const,
          shotQa: {},
          ...mediaFields(null),
          blockingIssues,
        })),
        registerFinalArtifact: vi.fn(async () => 'unused'),
      },
      storage: createStorage(),
      concat,
    })

    expect(result).toEqual({
      ok: false,
      incompleteNodeIds: [],
      blockingIssues,
    })
    expect(concat).not.toHaveBeenCalled()
  })

  it('commits a complete concat result through StorageAdapter', async () => {
    const tempRoot = await createTempRoot()
    const storage = createStorage()
    vi.mocked(storage.exists).mockResolvedValue(true)
    vi.mocked(storage.localPath).mockImplementation((key) => path.join(tempRoot, key))
    vi.mocked(storage.put).mockImplementation(async (key) => key)
    vi.mocked(storage.tempDir).mockImplementation((prefix) =>
      mkdtemp(path.join(tempRoot, prefix))
    )
    vi.mocked(storage.readLocalFile).mockImplementation((absolutePath) =>
      readFile(absolutePath)
    )
    vi.mocked(storage.removeTempDir).mockImplementation((absolutePath) =>
      rm(absolutePath, { recursive: true, force: true })
    )
    const registerFinalArtifact = vi.fn(
      async (_input: FinalArtifactInput) => 'artifact-final'
    )
    const concat = vi.fn(async (
      _plan: MediaAssemblyPlan,
      _paths: unknown,
      _subtitleAss: string | null,
      outputPath: string
    ) => {
      await writeFile(outputPath, Buffer.from('deterministic-final-mp4'))
      return outputPath
    })

    const result = await exportProject('project-1', {
      repository: {
        getExportPlan: vi.fn(async () => ({
          incompleteNodeIds: [],
          shots: [
            { nodeId: 'node-2', laneKey: 'S002', outputKey: 'render/S002.mp4' },
            { nodeId: 'node-1', laneKey: 'S001', outputKey: 'render/S001.mp4' },
          ],
          musicKey: null,
          subtitles: 'burn-in' as const,
          targetResolution: { width: 1920, height: 1080 },
          resolutionPreset: '1920x1080' as const,
          shotQa: {},
          ...mediaFields(completeMediaPlan()),
        })),
        registerFinalArtifact,
      },
      storage,
      concat,
    })

    expect(result).toMatchObject({ ok: true, artifactId: 'artifact-final' })
    expect(concat.mock.calls[0]?.[1]).toMatchObject({
      videoPaths: [
        path.join(tempRoot, 'render/S001.mp4'),
        path.join(tempRoot, 'render/S002.mp4'),
      ],
      narrationPaths: [
        path.join(tempRoot, 'audio/U001.mp3'),
        path.join(tempRoot, 'audio/U002.mp3'),
      ],
    })
    expect(concat.mock.calls[0]?.[2]).toContain('Dialogue:')
    expect(registerFinalArtifact.mock.calls[0]?.[0]).toMatchObject({
      subtitles: 'burn-in',
    })
    expect(storage.put).toHaveBeenCalledOnce()
    expect(registerFinalArtifact).toHaveBeenCalledOnce()
    expect(storage.removeTempDir).toHaveBeenCalledOnce()
  })

  it('produces no subtitle document at all for a subtitle-free delivery', async () => {
    const tempRoot = await createTempRoot()
    const storage = createStorage()
    vi.mocked(storage.exists).mockResolvedValue(true)
    vi.mocked(storage.localPath).mockImplementation((key) => path.join(tempRoot, key))
    vi.mocked(storage.tempDir).mockImplementation((prefix) =>
      mkdtemp(path.join(tempRoot, prefix))
    )
    vi.mocked(storage.readLocalFile).mockImplementation((absolutePath) =>
      readFile(absolutePath)
    )
    vi.mocked(storage.removeTempDir).mockImplementation((absolutePath) =>
      rm(absolutePath, { recursive: true, force: true })
    )
    const registerFinalArtifact = vi.fn(
      async (_input: FinalArtifactInput) => 'artifact-final'
    )
    const concat = vi.fn(async (
      _plan: MediaAssemblyPlan,
      _paths: unknown,
      _subtitleAss: string | null,
      outputPath: string
    ) => {
      await writeFile(outputPath, Buffer.from('deterministic-final-mp4'))
      return outputPath
    })
    const plan = completeMediaPlan()

    const result = await exportProject('project-1', {
      repository: {
        getExportPlan: vi.fn(async () => ({
          incompleteNodeIds: [],
          shots: [
            { nodeId: 'node-1', laneKey: 'S001', outputKey: 'render/S001.mp4' },
            { nodeId: 'node-2', laneKey: 'S002', outputKey: 'render/S002.mp4' },
          ],
          musicKey: null,
          subtitles: 'off' as const,
          targetResolution: { width: 1920, height: 1080 },
          resolutionPreset: '1920x1080' as const,
          shotQa: {},
          ...mediaFields({
            ...plan,
            subtitles: 'off' as const,
            shots: plan.shots.map((shot) => ({ ...shot, subtitle: null })),
          }),
        })),
        registerFinalArtifact,
      },
      storage,
      concat,
    })

    expect(result).toMatchObject({ ok: true })
    // null 而不是空字符串：concat 据此跳过写 .ass、跳过字体校验、去掉 ass 滤镜。
    expect(concat.mock.calls[0]?.[2]).toBeNull()
    // 交付形态跟着写进产物，页面才不会把无字幕成片说成硬字幕烧录。
    expect(registerFinalArtifact.mock.calls[0]?.[0]).toMatchObject({
      subtitles: 'off',
    })
  })

  it('cleans up the temp dir even when concat throws', async () => {
    const tempRoot = await createTempRoot()
    const storage = createStorage()
    vi.mocked(storage.exists).mockResolvedValue(true)
    vi.mocked(storage.localPath).mockImplementation((key) => path.join(tempRoot, key))
    vi.mocked(storage.tempDir).mockImplementation((prefix) =>
      mkdtemp(path.join(tempRoot, prefix))
    )
    vi.mocked(storage.removeTempDir).mockImplementation((absolutePath) =>
      rm(absolutePath, { recursive: true, force: true })
    )
    const concat = vi.fn(async () => {
      throw new Error('ffmpeg boom')
    })

    await expect(
      exportProject('project-1', {
        repository: {
          getExportPlan: vi.fn(async () => ({
            incompleteNodeIds: [],
            shots: [{ nodeId: 'node-1', laneKey: 'S001', outputKey: 'render/S001.mp4' }],
            musicKey: null,
            subtitles: 'burn-in' as const,
            targetResolution: { width: 1920, height: 1080 },
            resolutionPreset: '1920x1080' as const,
            shotQa: {},
            ...mediaFields(completeMediaPlan()),
          })),
          registerFinalArtifact: vi.fn(async () => 'unused'),
        },
        storage,
        concat,
      })
    ).rejects.toMatchObject({
      name: 'ExportExecutionError',
      safeDetails: { phase: 'concat', causeName: 'Error' },
    })

    expect(storage.removeTempDir).toHaveBeenCalledOnce()
  })
})

describe('getExportReadiness', () => {
  it('returns the latest trusted final artifact for refresh-safe preview', async () => {
    const result = await getExportReadiness('project-1', {
      getExportPlan: vi.fn(async () => ({
        incompleteNodeIds: [],
        shots: [{ nodeId: 'node-1', laneKey: 'S001', outputKey: 'render/S001.mp4' }],
        musicKey: null,
        subtitles: 'burn-in' as const,
        targetResolution: { width: 1920, height: 1080 },
        resolutionPreset: '1920x1080' as const,
        shotQa: { S001: true },
        ...mediaFields(completeMediaPlan()),
      })),
      findLatestFinalArtifact: vi.fn(async () => ({
        artifactId: 'artifact-final',
        path: 'exports/project-1/final.mp4',
        contentHash: 'hash-final',
        schemaVersion: 'cvc.final-video/v2',
        sizeBytes: 2_048,
      })),
      findDegradedExport: vi.fn(async () => null),
    })

    expect(result).toMatchObject({
      ready: true,
      finalArtifactId: 'artifact-final',
      artifactDelivery: 'narration-hard-subtitle-v2',
      finalArtifact: {
        artifactId: 'artifact-final',
        contentHash: 'hash-final',
        sizeBytes: 2_048,
        delivery: 'narration-hard-subtitle-v2',
      },
    })
  })

  it('describes an existing subtitle-free export from the artifact, not the current setting', async () => {
    // 已存在成片的形态来自它自己的 schemaVersion；此处刻意让当前设置与成片相反，
    // 确认页面不会用「现在的开关」去描述「过去的产物」。
    const result = await getExportReadiness('project-1', {
      getExportPlan: vi.fn(async () => ({
        incompleteNodeIds: [],
        shots: [{ nodeId: 'node-1', laneKey: 'S001', outputKey: 'render/S001.mp4' }],
        musicKey: null,
        subtitles: 'burn-in' as const,
        targetResolution: { width: 1920, height: 1080 },
        resolutionPreset: '1920x1080' as const,
        shotQa: { S001: true },
        ...mediaFields(completeMediaPlan()),
      })),
      findLatestFinalArtifact: vi.fn(async () => ({
        artifactId: 'artifact-final',
        path: 'exports/project-1/final.mp4',
        contentHash: 'hash-final',
        schemaVersion: 'cvc.final-video/v3',
        sizeBytes: 1_024,
      })),
      findDegradedExport: vi.fn(async () => null),
    })

    expect(result.subtitles).toBe('burn-in')
    expect(result.artifactDelivery).toBe('narration-no-subtitle-v3')
    expect(result.finalArtifact?.delivery).toBe('narration-no-subtitle-v3')
  })

  it('changes the idempotency fingerprint when the subtitle delivery changes', async () => {
    // 不进指纹的话，切换开关后重导出会命中同一个已完成作业并返回旧成片。
    const fingerprintFor = async (subtitles: 'burn-in' | 'off') =>
      (
        await getExportReadiness('project-1', {
          getExportPlan: vi.fn(async () => ({
            incompleteNodeIds: [],
            shots: [
              { nodeId: 'node-1', laneKey: 'S001', outputKey: 'render/S001.mp4' },
            ],
            musicKey: null,
            subtitles,
            targetResolution: { width: 1920, height: 1080 },
            resolutionPreset: '1920x1080' as const,
            shotQa: { S001: true },
            ...mediaFields(completeMediaPlan()),
          })),
          findLatestFinalArtifact: vi.fn(async () => null),
          findDegradedExport: vi.fn(async () => null),
        })
      ).inputFingerprint

    expect(await fingerprintFor('burn-in')).not.toBe(await fingerprintFor('off'))
    expect(await fingerprintFor('off')).toBe(await fingerprintFor('off'))
  })

  it('lists a skipped lane as a degraded placeholder candidate instead of a hard block', async () => {
    // 含 skipped 节点的项目：正常导出不就绪，但降级探测将该 lane 列为占位候选。
    const getExportPlan = vi
      .fn()
      .mockResolvedValueOnce({
        incompleteNodeIds: ['codegen-S002'],
        shots: [],
        musicKey: null,
        subtitles: 'burn-in',
        targetResolution: { width: 1920, height: 1080 },
        resolutionPreset: '1920x1080' as const,
        shotQa: {},
        ...mediaFields(null),
      })
      .mockResolvedValueOnce({
        incompleteNodeIds: ['codegen-S002'],
        shots: [],
        musicKey: null,
        subtitles: 'burn-in',
        targetResolution: { width: 1920, height: 1080 },
        resolutionPreset: '1920x1080' as const,
        shotQa: {},
        ...mediaFields(null),
        placeholderCandidates: [
          {
            laneKey: 'S002',
            durationInFrames: 60,
            audioUnitId: 'U002',
            needsVideo: true,
            needsNarration: false,
          },
        ],
        fps: 30 as const,
      })
    const result = await getExportReadiness('project-1', {
      getExportPlan,
      findLatestFinalArtifact: vi.fn(async () => null),
      findDegradedExport: vi.fn(async () => null),
    })

    expect(result).toMatchObject({
      ready: false,
      incompleteNodeIds: ['codegen-S002'],
      placeholderCandidateLanes: ['S002'],
      degradedReady: true,
    })
    expect(result.confirmationFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(getExportPlan).toHaveBeenNthCalledWith(2, 'project-1', {
      degraded: true,
    })
  })

  it('lists a QA waiver as degraded-ready without claiming QA passed', async () => {
    const getExportPlan = vi
      .fn()
      .mockResolvedValueOnce({
        incompleteNodeIds: ['qa-S004'],
        shots: [{ nodeId: 'codegen-S004', laneKey: 'S004', outputKey: 'render/S004.mp4' }],
        musicKey: null,
        subtitles: 'burn-in',
        targetResolution: { width: 1920, height: 1080 },
        resolutionPreset: '1920x1080' as const,
        shotQa: { S004: false },
        ...mediaFields(completeMediaPlan()),
        waivedQaLanes: ['S004'],
      })
      .mockResolvedValueOnce({
        incompleteNodeIds: ['qa-S004'],
        shots: [{ nodeId: 'codegen-S004', laneKey: 'S004', outputKey: 'render/S004.mp4' }],
        musicKey: null,
        subtitles: 'burn-in',
        targetResolution: { width: 1920, height: 1080 },
        resolutionPreset: '1920x1080' as const,
        shotQa: { S004: false },
        ...mediaFields(completeMediaPlan()),
        waivedQaLanes: ['S004'],
      })
    const result = await getExportReadiness('project-1', {
      getExportPlan,
      findLatestFinalArtifact: vi.fn(async () => null),
      findDegradedExport: vi.fn(async () => null),
    })

    expect(result).toMatchObject({
      ready: false,
      degradedReady: true,
      shotQa: { S004: false },
      waivedQaLanes: ['S004'],
    })
    expect(result.confirmationFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
})

function createStorage(): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn(async (key: string) => {
      const laneKey = key.includes('S002') ? 'S002' : 'S001'
      return Buffer.from(
        JSON.stringify({
          shotId: laneKey,
          sourceText: `字幕${laneKey}`,
          captions: [
            { text: `字幕${laneKey}`, startMs: 0, endMs: 900 },
          ],
        })
      )
    }),
    exists: vi.fn(),
    localPath: vi.fn(),
    delete: vi.fn(),
    tempDir: vi.fn(),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(),
  }
}

async function createTempRoot(): Promise<string> {
  const directory = path.join(os.tmpdir(), `cvc-export-${crypto.randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { recursive: true })
  return directory
}

function completeMediaPlan(): MediaAssemblyPlan {
  return {
    fps: 30 as const,
    totalFrames: 60,
    shots: ['S001', 'S002'].map((laneKey, index) => ({
      laneKey,
      video: {
        artifactId: `video-${laneKey}`,
        storageKey: `render/${laneKey}.mp4`,
        contentHash: String(index + 1).repeat(64),
      },
      durationInFrames: 30,
      narration: {
        unitId: `U00${index + 1}`,
        artifact: {
          artifactId: `audio-${laneKey}`,
          storageKey: `audio/U00${index + 1}.mp3`,
          contentHash: String(index + 3).repeat(64),
        },
        startInUnitMs: 0,
        endInUnitMs: 1_000,
      },
      subtitle: {
        artifactId: `subtitle-${laneKey}`,
        storageKey: `subtitle/${laneKey}.json`,
        contentHash: String(index + 5).repeat(64),
      },
    })),
    targetResolution: { width: 1920, height: 1080 },
    musicKey: null,
    subtitles: 'burn-in',
  }
}

function mediaFields(mediaAssemblyPlan: ReturnType<typeof completeMediaPlan> | null) {
  return {
    waivedQaLanes: [],
    mediaAssemblyPlan,
    blockingIssues: [],
    placeholderCandidates: [],
    placeholderLaneKeys: [],
    fps: mediaAssemblyPlan ? (30 as const) : null,
    media: {
      narrationReadyCount: mediaAssemblyPlan ? 1 : 0,
      subtitleReadyCount: mediaAssemblyPlan ? 1 : 0,
      requiredShotCount: 1,
      delivery: 'narration-hard-subtitle-v2' as const,
    },
  }
}
