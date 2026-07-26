import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import type { MediaAssemblyPlan } from './media-assembly'
import { exportProject, getExportReadiness } from './export-service'

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
    const registerFinalArtifact = vi.fn(async () => 'artifact-final')
    const concat = vi.fn(async (
      _plan: MediaAssemblyPlan,
      _paths: unknown,
      _subtitleAss: string,
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
    expect(storage.put).toHaveBeenCalledOnce()
    expect(registerFinalArtifact).toHaveBeenCalledOnce()
    expect(storage.removeTempDir).toHaveBeenCalledOnce()
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
    ).rejects.toThrow('ffmpeg boom')

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
      })),
    })

    expect(result).toMatchObject({
      ready: true,
      finalArtifactId: 'artifact-final',
      artifactDelivery: 'narration-hard-subtitle-v2',
    })
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
  }
}

function mediaFields(mediaAssemblyPlan: ReturnType<typeof completeMediaPlan> | null) {
  return {
    mediaAssemblyPlan,
    blockingIssues: [],
    media: {
      narrationReadyCount: mediaAssemblyPlan ? 1 : 0,
      subtitleReadyCount: mediaAssemblyPlan ? 1 : 0,
      requiredShotCount: 1,
      delivery: 'narration-hard-subtitle-v2' as const,
    },
  }
}
