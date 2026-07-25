import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import {
  ArtifactValidationError,
  writeValidatedArtifact,
} from './write-artifact'

vi.mock('server-only', () => ({}))

function createStorage(): StorageAdapter {
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

describe('writeValidatedArtifact', () => {
  it('validates and resolves a legal attempt before staging bytes', async () => {
    const order: string[] = []
    const storage = createStorage()
    vi.mocked(storage.put).mockImplementation(async (key) => {
      order.push('store')
      return key
    })
    const resolveAttempt = vi.fn(async () => {
      order.push('attempt')
      return 'attempt-1'
    })
    const result = await writeValidatedArtifact(
      {
        projectId: 'project-1',
        nodeId: 'node-1',
        kind: 'director-output',
        key: 'project-1/node-1/output.json',
        content: '{"ok":true}',
        validation: 'non-empty',
      },
      {
        storage,
        resolveAttempt,
        createId: () => 'artifact-1',
        validate: () => {
          order.push('validate')
          return { ok: true }
        },
      }
    )

    expect(order).toEqual(['validate', 'attempt', 'store'])
    expect(result).toMatchObject({
      id: 'artifact-1',
      aggregateType: 'node',
      aggregateId: 'node-1',
      attemptId: 'attempt-1',
      storageKey: 'project-1/node-1/output.json',
      sizeBytes: Buffer.byteLength('{"ok":true}'),
    })
  })

  it('does not write when pre-validation fails', async () => {
    const storage = createStorage()
    const resolveAttempt = vi.fn()
    const writing = writeValidatedArtifact(
      {
        projectId: 'project-1',
        kind: 'director-output',
        key: 'project-1/output.json',
        content: '',
        validation: 'non-empty',
      },
      {
        storage,
        resolveAttempt,
        validate: () => ({ ok: false, errors: ['内容无效'] }),
      }
    )

    await expect(writing).rejects.toBeInstanceOf(ArtifactValidationError)
    expect(storage.put).not.toHaveBeenCalled()
    expect(resolveAttempt).not.toHaveBeenCalled()
  })

  it('does not write bytes when no legal attempt exists', async () => {
    const storage = createStorage()
    const failure = new Error('找不到可归属的 task attempt')

    await expect(
      writeValidatedArtifact(
        {
          projectId: 'project-1',
          kind: 'director-output',
          key: 'project-1/output.json',
          content: '{"ok":true}',
          validation: 'non-empty',
        },
        {
          storage,
          resolveAttempt: vi.fn(async () => {
            throw failure
          }),
        }
      )
    ).rejects.toBe(failure)

    expect(storage.put).not.toHaveBeenCalled()
  })
})
