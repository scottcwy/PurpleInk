import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import {
  ArtifactValidationError,
  writeValidatedArtifact,
} from './write-artifact'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

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

  it('does not stage deterministic HTML with a portrait composition contract', async () => {
    const storage = createStorage()
    const resolveAttempt = vi.fn()
    const portrait = `<!doctype html><html><head>
<meta name="viewport" content="width=1080, height=1920"></head>
<body><main data-composition-id="shot" data-width="1080" data-height="1920"></main>
<script>const timeline = gsap.timeline({ paused: true }); timeline.seek(frame / fps);</script>
</body></html>`

    await expect(
      writeValidatedArtifact(
        {
          projectId: 'project-1',
          nodeId: 'node-1',
          kind: 'director-fabricate',
          key: 'project-1/node-1/shot.html',
          content: portrait,
          validation: 'deterministic-html',
        },
        { storage, resolveAttempt }
      )
    ).rejects.toThrow('composition-width')
    expect(resolveAttempt).not.toHaveBeenCalled()
    expect(storage.put).not.toHaveBeenCalled()
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
