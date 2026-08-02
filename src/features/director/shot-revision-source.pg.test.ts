import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
import type { StorageAdapter } from '@/lib/storage'
import { loadShotRevisionSource } from './shot-revision-source'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => WORKSPACE_ID,
  currentUserId: () => 'test-user',
}))

const WORKSPACE_ID = '21000000-0000-4000-8000-000000000001'
const PROJECT_ID = '22000000-0000-4000-8000-000000000001'
const NODE_ID = '23000000-0000-4000-8000-000000000001'
const RUN_ID = '24000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '25000000-0000-4000-8000-000000000001'
const TRUSTED_ID = '26000000-0000-4000-8000-000000000001'
const REJECTED_ID = '26000000-0000-4000-8000-000000000002'
const SOURCE_HTML =
  '<!doctype html><html><style>.title{color:red}</style><h1>旧标题</h1></html>'

function createStorage(files: Map<string, Buffer>): StorageAdapter {
  return {
    put: vi.fn(async (key, data) => {
      files.set(key, Buffer.from(data))
      return key
    }),
    get: vi.fn(async (key) => {
      const value = files.get(key)
      if (!value) throw new Error(`未登记的产物内容：${key}`)
      return value
    }),
    exists: vi.fn(async (key) => files.has(key)),
    localPath: vi.fn((key) => key),
    materializeLocalPath: vi.fn(async (key) => key),
    delete: vi.fn(async (key) => {
      files.delete(key)
    }),
    tempDir: vi.fn(async (prefix) => prefix),
    readLocalFile: vi.fn(async () => Buffer.alloc(0)),
    removeTempDir: vi.fn(async () => {}),
  }
}

describe('loadShotRevisionSource', () => {
  let database: PgTestDatabase

  beforeAll(async () => {
    database = await createPgTestDatabase()
  })

  beforeEach(async () => {
    await database.reset()
  })

  afterAll(async () => {
    await database.close()
  })

  it('reads every byte from the latest non-rejected FABRICATE artifact', async () => {
    await seedArtifactOwners(database)
    await database.db.insert(artifacts).values([
      {
        workspaceId: WORKSPACE_ID,
        id: TRUSTED_ID,
        projectId: PROJECT_ID,
        aggregateType: 'node',
        aggregateId: NODE_ID,
        kind: 'director-fabricate',
        schemaVersion: 'cvc.fabricate/v1',
        version: 1,
        lifecycle: 'draft',
        storageKey: 'trusted/current.html',
        sizeBytes: Buffer.byteLength(SOURCE_HTML),
        contentHash: 'a'.repeat(64),
        attemptId: ATTEMPT_ID,
      },
      {
        workspaceId: WORKSPACE_ID,
        id: REJECTED_ID,
        projectId: PROJECT_ID,
        aggregateType: 'node',
        aggregateId: NODE_ID,
        kind: 'director-fabricate',
        schemaVersion: 'cvc.fabricate/v1',
        version: 2,
        lifecycle: 'rejected',
        storageKey: 'rejected/newer.html',
        sizeBytes: 8,
        contentHash: 'b'.repeat(64),
        attemptId: ATTEMPT_ID,
      },
    ])
    const storage = createStorage(
      new Map([
        ['trusted/current.html', Buffer.from(SOURCE_HTML)],
        ['rejected/newer.html', Buffer.from('rejected')],
      ]),
    )

    await expect(
      loadShotRevisionSource(database.db, storage, PROJECT_ID, NODE_ID),
    ).resolves.toBe(SOURCE_HTML)
    expect(storage.get).toHaveBeenCalledWith('trusted/current.html')
  })

  it('fails before model execution when no editable HTML exists', async () => {
    await expect(
      loadShotRevisionSource(
        database.db,
        createStorage(new Map()),
        PROJECT_ID,
        NODE_ID,
      ),
    ).rejects.toThrow('节点缺少可修订的 director-fabricate 产物')
  })
})

async function seedArtifactOwners(database: PgTestDatabase): Promise<void> {
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'shot-revision',
    name: 'Shot Revision',
  })
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: PROJECT_ID,
    title: '分镜修订',
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: RUN_ID,
    projectId: PROJECT_ID,
    status: 'running',
    workflowVersion: 'test',
    fingerprint: 'f'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: ATTEMPT_ID,
    runId: RUN_ID,
    taskId: 'cvc.shot.revision',
    entityType: 'node',
    entityId: NODE_ID,
    attemptNo: 1,
    status: 'running',
    fingerprint: 'f'.repeat(64),
    checkpoint: { schemaVersion: 1 },
  })
}
