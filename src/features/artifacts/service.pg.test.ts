import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db/client'
import {
  artifacts,
  pipelineRuns,
  projects,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { getLatestArtifact, readArtifact } from './service'

/**
 * 跨 workspace 产物隔离（PLAN-002 §5.6 / §8.2 必测项）：
 * A 用户拿 B 的 (projectId, artifactId) 组合读产物必须落空，
 * DB 行就是守门人，不依赖目录结构。
 */
const { getDbMock, storageGetMock, contextRef } = vi.hoisted(() => ({
  getDbMock: vi.fn<() => Promise<Db>>(),
  storageGetMock: vi.fn(async () => Buffer.from('artifact-bytes')),
  contextRef: { workspaceId: '' },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({
  getDb: getDbMock,
  LOCAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
}))
vi.mock('@/lib/storage', () => ({ storage: { get: storageGetMock } }))
// 用例通过 contextRef 切换「当前登录者」的 workspace。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => contextRef.workspaceId,
  currentUserId: () => 'test-user',
}))

const WORKSPACE_A = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_B = '00000000-0000-4000-8000-00000000000b'

let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  getDbMock.mockResolvedValue(database.db)
  contextRef.workspaceId = WORKSPACE_A
})

afterAll(async () => {
  await database.close()
})

interface SeededArtifact {
  projectId: string
  artifactId: string
}

async function seedWorkspaceArtifact(workspaceId: string, slug: string): Promise<SeededArtifact> {
  const projectId = randomUUID()
  const artifactId = randomUUID()
  const runId = randomUUID()
  const attemptId = randomUUID()
  await database.db.insert(workspaces).values({ id: workspaceId, slug, name: slug })
  await database.db.insert(projects).values({
    workspaceId,
    id: projectId,
    title: `${slug} 项目`,
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  await database.db.insert(pipelineRuns).values({
    workspaceId,
    id: runId,
    projectId,
    status: 'succeeded',
    workflowVersion: 'test',
    fingerprint: 'f'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId,
    id: attemptId,
    runId,
    taskId: 'legacy.export-project',
    entityType: 'project',
    entityId: projectId,
    attemptNo: 1,
    status: 'succeeded',
    fingerprint: 'f'.repeat(64),
    checkpoint: { schemaVersion: 1, kind: 'export-project', payload: {} },
  })
  await database.db.insert(artifacts).values({
    workspaceId,
    id: artifactId,
    projectId,
    aggregateType: 'project',
    aggregateId: projectId,
    kind: 'final-mp4',
    schemaVersion: 'cvc.final-video/v2',
    version: 1,
    lifecycle: 'approved',
    storageKey: `${slug}/final.mp4`,
    sizeBytes: 14,
    contentHash: 'c'.repeat(64),
    attemptId,
  })
  return { projectId, artifactId }
}

describe('artifacts 跨 workspace 隔离', () => {
  it('同 workspace 读取命中；A 上下文拿 B 的 (projectId, artifactId) 必须落空', async () => {
    const mine = await seedWorkspaceArtifact(WORKSPACE_A, 'ws-a')
    const theirs = await seedWorkspaceArtifact(WORKSPACE_B, 'ws-b')

    // 正向：自己的产物可读，字节来自 storage。
    const own = await readArtifact(mine.projectId, mine.artifactId)
    expect(own.descriptor.id).toBe(mine.artifactId)
    expect(own.bytes.toString()).toBe('artifact-bytes')

    // 反向：B 的组合在 A 上下文下一律「不存在」，且不触发字节读取。
    storageGetMock.mockClear()
    await expect(
      readArtifact(theirs.projectId, theirs.artifactId),
    ).rejects.toThrow('产物不存在或不属于该项目')
    expect(storageGetMock).not.toHaveBeenCalled()

    // getLatestArtifact 同口径：跨 workspace 查询不命中。
    await expect(
      getLatestArtifact(theirs.projectId, null, 'final-mp4'),
    ).resolves.toBeNull()

    // 切到 B 上下文后，B 自己的产物恢复可见。
    contextRef.workspaceId = WORKSPACE_B
    await expect(
      getLatestArtifact(theirs.projectId, null, 'final-mp4'),
    ).resolves.toMatchObject({ id: theirs.artifactId })
  })
})
