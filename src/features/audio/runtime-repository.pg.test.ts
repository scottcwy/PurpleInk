import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
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
import { mp3Frames } from './mp3.fixture'
import { AudioRuntimeRepository } from './runtime-repository'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

vi.mock('server-only', () => ({}))

const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const NODE_ID = '20000000-0000-4000-8000-000000000001'
const RUN_ID = '30000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '40000000-0000-4000-8000-000000000001'
const AUDIO_ID = '50000000-0000-4000-8000-000000000001'
const AUDIO_KEY = `narration/${PROJECT_ID}/u001.mp3`
const AUDIO_BYTES = mp3Frames(2)
const AUDIO_HASH = createHash('sha256').update(AUDIO_BYTES).digest('hex')
const FINGERPRINT = 'a'.repeat(64)

function testStorage(): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn(async (key: string) => {
      if (key === AUDIO_KEY) return AUDIO_BYTES
      throw new Error(`不应读取其他 workspace 的对象：${key}`)
    }),
    exists: vi.fn(),
    localPath: vi.fn(),
    delete: vi.fn(),
    tempDir: vi.fn(),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(),
  }
}

describe('AudioRuntimeRepository', () => {
  let database: PgTestDatabase
  let db: Db
  let storage: StorageAdapter

  beforeAll(async () => {
    database = await createPgTestDatabase()
    db = database.db
    await seedWorkspace(db, LOCAL_WORKSPACE_ID, '')
    await seedWorkspace(db, OTHER_WORKSPACE_ID, 'other/')
  })

  beforeEach(() => {
    storage = testStorage()
  })

  afterAll(async () => {
    await database.close()
  })

  it('loads the INGEST narration audio only from the trusted workspace', async () => {
    const repository = new AudioRuntimeRepository(db, storage)

    const source = await repository.loadNarration(PROJECT_ID, 'U001')

    expect(source).toEqual({
      unitId: 'U001',
      audioArtifactId: AUDIO_ID,
      audioKey: AUDIO_KEY,
      audioBytes: AUDIO_BYTES,
      audioFormat: 'mp3',
      contentHash: AUDIO_HASH,
      sizeBytes: AUDIO_BYTES.byteLength,
    })
    expect(storage.get).not.toHaveBeenCalledWith(expect.stringContaining('other/'))
  })

  it('rejects audio bytes that do not match the indexed content hash', async () => {
    vi.mocked(storage.get).mockImplementationOnce(async () =>
      Buffer.alloc(AUDIO_BYTES.byteLength, 9)
    )
    const repository = new AudioRuntimeRepository(db, storage)

    await expect(repository.loadNarration(PROJECT_ID, 'U001')).rejects.toThrow(
      'hash 不一致'
    )
  })

  it('rejects audio bytes whose actual size does not match the indexed size', async () => {
    await db
      .update(artifacts)
      .set({ sizeBytes: AUDIO_BYTES.byteLength + 1 })
      .where(eq(artifacts.id, AUDIO_ID))
    const repository = new AudioRuntimeRepository(db, storage)

    await expect(repository.loadNarration(PROJECT_ID, 'U001')).rejects.toThrow(
      'size 不一致'
    )

    await db
      .update(artifacts)
      .set({ sizeBytes: AUDIO_BYTES.byteLength })
      .where(eq(artifacts.id, AUDIO_ID))
  })

  it('fails instead of inventing audio when INGEST produced none', async () => {
    const repository = new AudioRuntimeRepository(db, storage)

    await expect(repository.loadNarration(PROJECT_ID, 'U404')).rejects.toThrow(
      'narration-audio:U404'
    )
  })
})

async function seedWorkspace(
  db: Db,
  workspaceId: string,
  storagePrefix: string
): Promise<void> {
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: workspaceId,
    name: workspaceId,
  })
  await db.insert(projects).values({
    workspaceId,
    id: PROJECT_ID,
    title: '项目',
    script: '原稿',
    workflowVersion: 'test-v1',
    exportSettings: { schemaVersion: 1 },
  })
  // loadNarration 只按 workspace/project/kind 查 artifacts，不 join canvas_nodes，
  // 因此 fixture 也不播种画布节点：依赖面必须与实现一致。
  await db.insert(pipelineRuns).values({
    workspaceId,
    id: RUN_ID,
    projectId: PROJECT_ID,
    status: 'running',
    workflowVersion: 'test-v1',
    fingerprint: FINGERPRINT,
  })
  await db.insert(taskAttempts).values({
    workspaceId,
    id: ATTEMPT_ID,
    runId: RUN_ID,
    taskId: 'cvc.script.ingest',
    entityType: 'node',
    entityId: NODE_ID,
    attemptNo: 1,
    status: 'running',
    fingerprint: FINGERPRINT,
    checkpoint: { schemaVersion: 1 },
  })
  await db.insert(artifacts).values({
    workspaceId,
    id: AUDIO_ID,
    projectId: PROJECT_ID,
    aggregateType: 'node',
    aggregateId: NODE_ID,
    kind: 'narration-audio:U001',
    version: 1,
    lifecycle: 'draft',
    schemaVersion: 'cvc.narration-audio/v1',
    storageKey: `${storagePrefix}${AUDIO_KEY}`,
    sizeBytes: AUDIO_BYTES.byteLength,
    contentHash: AUDIO_HASH,
    attemptId: ATTEMPT_ID,
  })
}
