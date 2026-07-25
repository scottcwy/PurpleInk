import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import {
  artifacts,
  canvasNodes,
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
import { AudioRuntimeRepository } from './runtime-repository'

vi.mock('server-only', () => ({}))

const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const NODE_ID = '20000000-0000-4000-8000-000000000001'
const RUN_ID = '30000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '40000000-0000-4000-8000-000000000001'
const AUDIO_ID = '50000000-0000-4000-8000-000000000001'
const METADATA_ID = '60000000-0000-4000-8000-000000000001'
const AUDIO_KEY = `audio/${PROJECT_ID}/S001/voiceover.mp3`
const METADATA_KEY = `audio/${PROJECT_ID}/S001/voiceover.json`
const HASH = 'a'.repeat(64)

function testStorage(): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn(async (key: string) => {
      if (key === AUDIO_KEY) return Buffer.from([1, 2, 3])
      if (key === METADATA_KEY) return metadataBytes(AUDIO_KEY)
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

function metadataBytes(audioKey: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      shotId: 'S001',
      model: 'stepaudio-2.5-tts',
      durationMs: 1200,
      audioArtifactId: AUDIO_ID,
      audioKey,
      audioFormat: 'mp3',
      nativeCaptions: [{ startMs: 0, endMs: 1200, text: '旁白' }],
    })
  )
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

  it('loads a traceable voiceover only from the trusted workspace and lane', async () => {
    const repository = new AudioRuntimeRepository(db, storage)

    const source = await repository.loadVoiceover(PROJECT_ID, 'S001')

    expect(source).toEqual(
      expect.objectContaining({
        audioArtifactId: AUDIO_ID,
        audioKey: AUDIO_KEY,
        audioFormat: 'mp3',
        durationMs: 1200,
      })
    )
    expect(source.audioBytes).toEqual(Buffer.from([1, 2, 3]))
    expect(storage.get).not.toHaveBeenCalledWith(expect.stringContaining('other/'))
  })

  it('rejects metadata that points outside the indexed audio artifact', async () => {
    vi.mocked(storage.get).mockImplementationOnce(async () =>
      metadataBytes(`audio/${PROJECT_ID}/S001/other.mp3`)
    )
    const repository = new AudioRuntimeRepository(db, storage)

    await expect(repository.loadVoiceover(PROJECT_ID, 'S001')).rejects.toThrow(
      '索引不一致'
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
  await db.insert(canvasNodes).values({
    workspaceId,
    id: NODE_ID,
    projectId: PROJECT_ID,
    logicalKey: 'shot:S001:shot-sfx',
    type: 'shot-sfx',
    stage: 'ASSEMBLE',
    positionX: 0,
    positionY: 0,
    data: { schemaVersion: 1 },
    status: 'succeeded',
  })
  await db.insert(pipelineRuns).values({
    workspaceId,
    id: RUN_ID,
    projectId: PROJECT_ID,
    status: 'running',
    workflowVersion: 'test-v1',
    fingerprint: HASH,
  })
  await db.insert(taskAttempts).values({
    workspaceId,
    id: ATTEMPT_ID,
    runId: RUN_ID,
    taskId: 'cvc.shot.media',
    entityType: 'node',
    entityId: NODE_ID,
    attemptNo: 1,
    status: 'running',
    fingerprint: HASH,
    checkpoint: { schemaVersion: 1 },
  })
  await db.insert(artifacts).values([
    {
      workspaceId,
      id: AUDIO_ID,
      projectId: PROJECT_ID,
      aggregateType: 'node',
      aggregateId: NODE_ID,
      kind: 'voiceover-audio',
      version: 1,
      lifecycle: 'draft',
      schemaVersion: 'cvc.audio-artifact/v1',
      storageKey: `${storagePrefix}${AUDIO_KEY}`,
      sizeBytes: 3,
      contentHash: HASH,
      attemptId: ATTEMPT_ID,
    },
    {
      workspaceId,
      id: METADATA_ID,
      projectId: PROJECT_ID,
      aggregateType: 'node',
      aggregateId: NODE_ID,
      kind: 'voiceover-metadata',
      version: 1,
      lifecycle: 'draft',
      schemaVersion: 'cvc.audio-artifact/v1',
      storageKey: `${storagePrefix}${METADATA_KEY}`,
      sizeBytes: 128,
      contentHash: HASH,
      attemptId: ATTEMPT_ID,
    },
  ])
}
