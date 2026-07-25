import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import { storeAudioArtifact } from './repository'

vi.mock('server-only', () => ({}))

function storage(): StorageAdapter {
  return {
    put: vi.fn(async (key: string) => key),
    get: vi.fn(),
    exists: vi.fn(),
    localPath: vi.fn(),
    delete: vi.fn(),
    tempDir: vi.fn(),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(),
  }
}

describe('storeAudioArtifact', () => {
  it('resolves a legal attempt before writing bytes and registering the artifact', async () => {
    const target = storage()
    const order: string[] = []
    vi.mocked(target.put).mockImplementation(async (key) => {
      order.push('store')
      return key
    })
    const insertArtifact = vi.fn(async () => {
      order.push('index')
    })
    const resolveAttemptId = vi.fn(async () => {
      order.push('attempt')
      return 'attempt-1'
    })

    const result = await storeAudioArtifact(
      {
        projectId: 'project-1',
        nodeId: 'node-1',
        shotId: 'S001',
        kind: 'voiceover-audio',
        extension: 'mp3',
        data: Buffer.from([1, 2, 3]),
      },
      {
        storage: target,
        resolveAttemptId,
        insertArtifact,
        createId: () => 'artifact-1',
      }
    )

    expect(order).toEqual(['attempt', 'store', 'index'])
    expect(resolveAttemptId).toHaveBeenCalledWith('project-1', 'node-1')
    expect(result.id).toBe('artifact-1')
    expect(result.storageKey).toMatch(
      /^audio\/project-1\/S001\/voiceover-audio-[0-9a-f]{64}-artifact-1\.mp3$/
    )
    expect(insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'artifact-1',
        workspaceId: '00000000-0000-4000-8000-000000000001',
        projectId: 'project-1',
        aggregateType: 'node',
        aggregateId: 'node-1',
        kind: 'voiceover-audio',
        lifecycle: 'draft',
        schemaVersion: 'cvc.audio-artifact/v1',
        storageKey: result.storageKey,
        sizeBytes: 3,
        contentHash: result.contentHash,
        attemptId: 'attempt-1',
      })
    )
  })

  it('deletes stored bytes if artifact indexing fails', async () => {
    const target = storage()
    const failure = new Error('索引失败')

    await expect(
      storeAudioArtifact(
        {
          projectId: 'project-1',
          nodeId: 'node-1',
          shotId: 'S001',
          kind: 'subtitle-track',
          extension: 'json',
          data: '{}',
        },
        {
          storage: target,
          resolveAttemptId: vi.fn(async () => 'attempt-1'),
          insertArtifact: vi.fn(async () => {
            throw failure
          }),
          createId: () => 'artifact-1',
        }
      )
    ).rejects.toBe(failure)
    expect(target.delete).toHaveBeenCalledOnce()
  })

  it('does not delete a concurrent successful upload with the same content hash', async () => {
    const target = storage()
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('artifact-success')
      .mockReturnValueOnce('artifact-failure')
    const insertArtifact = vi.fn(
      async (record: { id: string; contentHash: string; storageKey: string }) => {
        if (record.id === 'artifact-failure') throw new Error('索引失败')
      }
    )

    const outcomes = await Promise.allSettled([
      storeAudioArtifact(
        {
          projectId: 'project-1',
          nodeId: 'node-1',
          shotId: 'S001',
          kind: 'voiceover-audio',
          extension: 'mp3',
          data: Buffer.from([1, 2, 3]),
        },
        {
          storage: target,
          resolveAttemptId: vi.fn(async () => 'attempt-1'),
          insertArtifact,
          createId,
        }
      ),
      storeAudioArtifact(
        {
          projectId: 'project-1',
          nodeId: 'node-1',
          shotId: 'S001',
          kind: 'voiceover-audio',
          extension: 'mp3',
          data: Buffer.from([1, 2, 3]),
        },
        {
          storage: target,
          resolveAttemptId: vi.fn(async () => 'attempt-2'),
          insertArtifact,
          createId,
        }
      ),
    ])

    expect(outcomes.map(({ status }) => status)).toEqual([
      'fulfilled',
      'rejected',
    ])
    expect(insertArtifact).toHaveBeenCalledTimes(2)
    const successfulRecord = insertArtifact.mock.calls[0]![0]
    const failedRecord = insertArtifact.mock.calls[1]![0]
    expect(successfulRecord.contentHash).toBe(failedRecord.contentHash)
    expect(successfulRecord.storageKey).not.toBe(failedRecord.storageKey)
    expect(target.delete).toHaveBeenCalledExactlyOnceWith(
      failedRecord.storageKey
    )
  })

  it('does not write bytes when no legal task attempt exists', async () => {
    const target = storage()
    const failure = new Error('找不到可归属的 task attempt')

    await expect(
      storeAudioArtifact(
        {
          projectId: 'project-1',
          nodeId: 'node-1',
          shotId: 'S001',
          kind: 'voiceover-audio',
          extension: 'mp3',
          data: Buffer.from([1]),
        },
        {
          storage: target,
          resolveAttemptId: vi.fn(async () => {
            throw failure
          }),
          insertArtifact: vi.fn(),
          createId: () => 'artifact-1',
        }
      )
    ).rejects.toBe(failure)
    expect(target.put).not.toHaveBeenCalled()
  })

  it('rejects identifiers that could escape the storage root', async () => {
    const target = storage()

    await expect(
      storeAudioArtifact(
        {
          projectId: '../outside',
          nodeId: 'node-1',
          shotId: 'S001',
          kind: 'voiceover-audio',
          extension: 'mp3',
          data: Buffer.from([1]),
        },
        {
          storage: target,
          resolveAttemptId: vi.fn(async () => 'attempt-1'),
          insertArtifact: vi.fn(),
          createId: () => 'artifact-1',
        }
      )
    ).rejects.toThrow('projectId')
    expect(target.put).not.toHaveBeenCalled()
  })
})
