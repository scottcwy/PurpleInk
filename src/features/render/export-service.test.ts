import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
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
          targetResolution: { width: 1080, height: 1920 },
          resolutionPreset: '1080x1920' as const,
          shotQa: {},
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
    const concat = vi.fn<
      (
        shots: string[],
        music: string | null,
        outputPath: string,
        targetResolution?: { width: number; height: number } | null
      ) => Promise<string>
    >(async (_shots, _music, outputPath) => {
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
          targetResolution: { width: 1080, height: 1920 },
          resolutionPreset: '1080x1920' as const,
          shotQa: {},
        })),
        registerFinalArtifact,
      },
      storage,
      concat,
    })

    expect(result).toMatchObject({ ok: true, artifactId: 'artifact-final' })
    expect(concat.mock.calls[0]?.[0]).toEqual([
      path.join(tempRoot, 'render/S001.mp4'),
      path.join(tempRoot, 'render/S002.mp4'),
    ])
    expect(concat.mock.calls[0]?.[3]).toEqual({ width: 1080, height: 1920 })
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
            targetResolution: { width: 1080, height: 1920 },
            resolutionPreset: '1080x1920' as const,
            shotQa: {},
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
        targetResolution: { width: 1080, height: 1920 },
        resolutionPreset: '1080x1920' as const,
        shotQa: { S001: true },
      })),
      findLatestFinalArtifact: vi.fn(async () => ({
        artifactId: 'artifact-final',
        path: 'exports/project-1/final.mp4',
        contentHash: 'hash-final',
      })),
    })

    expect(result).toMatchObject({
      ready: true,
      finalArtifactId: 'artifact-final',
    })
  })
})

function createStorage(): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn(),
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
