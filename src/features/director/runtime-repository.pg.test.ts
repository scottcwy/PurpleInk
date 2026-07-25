import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
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
import { DirectorRuntimeRepository } from './runtime-repository'
import type { ArtifactCommitResult } from './tools/write-artifact'

vi.mock('server-only', () => ({}))

const PROJECT_ID = '11000000-0000-4000-8000-000000000001'
const RUN_ID = '12000000-0000-4000-8000-000000000001'
const INGEST_ID = '13000000-0000-4000-8000-000000000001'
const SPLIT_ID = '13000000-0000-4000-8000-000000000002'
const SCORE_ID = '13000000-0000-4000-8000-000000000003'
const SHOT_SCRIPT_ID = '13000000-0000-4000-8000-000000000004'
const CODEGEN_ID = '13000000-0000-4000-8000-000000000005'
const ATTEMPTS = new Map<string, string>()
const HASH = 'a'.repeat(64)

function createStorage(files: Map<string, Buffer>): StorageAdapter {
  return {
    put: vi.fn(async (key: string, data: string | Buffer | Uint8Array) => {
      files.set(key, Buffer.from(data))
      return key
    }),
    get: vi.fn(async (key: string) => {
      const value = files.get(key)
      if (!value) throw new Error(`未登记的产物内容：${key}`)
      return value
    }),
    exists: vi.fn(async (key: string) => files.has(key)),
    localPath: vi.fn(),
    delete: vi.fn(async (key: string) => {
      files.delete(key)
    }),
    tempDir: vi.fn(),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(),
  }
}

describe('DirectorRuntimeRepository Postgres', () => {
  let database: PgTestDatabase
  let db: Db
  let files: Map<string, Buffer>
  let storage: StorageAdapter
  let repository: DirectorRuntimeRepository

  beforeAll(async () => {
    database = await createPgTestDatabase()
    db = database.db
    await seedGraph(db)
  })

  beforeEach(() => {
    files = seedFiles()
    storage = createStorage(files)
    repository = new DirectorRuntimeRepository(db, storage)
  })

  afterAll(async () => {
    await database.close()
  })

  it('maps queued status and unwraps only the trusted workspace payload', async () => {
    const context = await repository.loadStageContext(
      PROJECT_ID,
      INGEST_ID,
      'INGEST'
    )

    expect(context).toMatchObject({
      projectId: PROJECT_ID,
      nodeId: INGEST_ID,
      status: 'pending',
      directorInput: { rawScript: '节点脚本' },
    })
    await expect(
      repository.loadStageContext(PROJECT_ID, INGEST_ID, 'DIRECT')
    ).rejects.toThrow('阶段不匹配')
  })

  it('checks workspace ownership, stage, and persisted status before enqueue', async () => {
    await db
      .update(canvasNodes)
      .set({ status: 'idle' })
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, INGEST_ID)
        )
      )

    await expect(
      repository.assertEnqueueable(PROJECT_ID, INGEST_ID, 'INGEST')
    ).resolves.toBeUndefined()
    await expect(
      repository.assertEnqueueable(PROJECT_ID, INGEST_ID, 'DIRECT')
    ).rejects.toThrow('阶段不匹配')
    await expect(
      repository.assertEnqueueable(randomUUID(), INGEST_ID, 'INGEST')
    ).rejects.toThrow('不属于项目')

    await db
      .update(canvasNodes)
      .set({ status: 'queued' })
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, INGEST_ID)
        )
      )
  })

  it('commits stream bytes with real hash/size and skips empty text', async () => {
    await repository.persistStreamLog(
      PROJECT_ID,
      INGEST_ID,
      'INGEST',
      '流式全文'
    )
    const [row] = await db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
          eq(artifacts.aggregateId, INGEST_ID),
          eq(artifacts.kind, 'director-stream-log')
        )
      )
    expect(row).toMatchObject({
      aggregateType: 'node',
      sizeBytes: Buffer.byteLength('流式全文'),
      contentHash: createHash('sha256').update('流式全文').digest('hex'),
    })

    await repository.persistStreamLog(PROJECT_ID, INGEST_ID, 'INGEST', '')
    expect(vi.mocked(storage.put)).toHaveBeenCalledTimes(1)
  })

  it('commits an actual pointer and rejects unsafe storage keys', async () => {
    files.set('pi/session.jsonl', Buffer.from('session'))
    await expect(
      repository.registerArtifactPointer({
        projectId: PROJECT_ID,
        nodeId: INGEST_ID,
        kind: 'pi-session',
        storageKey: 'pi/session.jsonl',
      })
    ).resolves.toEqual(expect.any(String))
    await expect(
      repository.registerArtifactPointer({
        projectId: PROJECT_ID,
        nodeId: INGEST_ID,
        kind: 'pi-session',
        storageKey: 'D:\\secret.jsonl',
      })
    ).rejects.toThrow('相对')
  })

  it('atomically commits the staged artifact and node projection', async () => {
    const staged = stagedArtifact(CODEGEN_ID, 'director-fabricate')
    files.set(staged.storageKey, Buffer.from('<!doctype html>'))
    await repository.recordStageOutput(
      CODEGEN_ID,
      {
        content: '<!doctype html>',
        renderSpec: {
          fps: 30,
          durationInFrames: 45,
          width: 1080,
          height: 1920,
          seed: 42,
        },
      },
      staged
    )

    const [node] = await db
      .select({ data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, CODEGEN_ID)
        )
      )
    const payload = (
      node?.data as unknown as { payload: Record<string, unknown> }
    ).payload
    expect(payload).toMatchObject({
      directorArtifactId: staged.id,
      renderSpec: { seed: 42 },
    })
    await expect(
      db
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
            eq(artifacts.id, staged.id)
          )
        )
    ).resolves.toHaveLength(1)
  })

  it('assembles score input from versioned lane payload and artifact rows', async () => {
    const context = await repository.loadStageContext(
      PROJECT_ID,
      SCORE_ID,
      'ASSEMBLE'
    )
    const input = context.directorInput as {
      shotPlan: { shots: Array<{ id: string }> }
      renderedArtifactKeys: string[]
    }
    expect(input.shotPlan.shots.map(({ id }) => id)).toEqual(['S001'])
    expect(input.renderedArtifactKeys).toEqual(['render/S001.mp4'])
  })
})

async function seedGraph(db: Db): Promise<void> {
  await db.insert(workspaces).values({
    id: LOCAL_WORKSPACE_ID,
    slug: 'local',
    name: 'Local',
  })
  await db.insert(projects).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: PROJECT_ID,
    title: '项目',
    script: '原始脚本',
    workflowVersion: 'test-v1',
    exportSettings: { schemaVersion: 1 },
  })
  const nodes = [
    node(INGEST_ID, 'script-import', 'INGEST', 'queued', {
      directorInput: { rawScript: '节点脚本' },
    }),
    node(SPLIT_ID, 'shot-split', 'DIRECT', 'succeeded'),
    node(SCORE_ID, 'score', 'ASSEMBLE', 'queued'),
    node(SHOT_SCRIPT_ID, 'shot-script', 'SHOT_SPEC', 'succeeded', {
      laneKey: 'S001',
    }),
    node(CODEGEN_ID, 'shot-codegen', 'FABRICATE', 'succeeded', {
      laneKey: 'S001',
    }),
  ]
  await db.insert(canvasNodes).values(nodes)
  await db.insert(pipelineRuns).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: RUN_ID,
    projectId: PROJECT_ID,
    status: 'running',
    workflowVersion: 'test-v1',
    fingerprint: HASH,
  })
  for (const [index, target] of nodes.entries()) {
    const attemptId = `14000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    ATTEMPTS.set(target.id, attemptId)
    await db.insert(taskAttempts).values({
      workspaceId: LOCAL_WORKSPACE_ID,
      id: attemptId,
      runId: RUN_ID,
      taskId: 'cvc.project.plan',
      entityType: 'node',
      entityId: target.id,
      attemptNo: 1,
      status: 'running',
      fingerprint: HASH,
      checkpoint: { schemaVersion: 1 },
    })
  }
  await seedArtifact(db, INGEST_ID, 'director-ingest', 'input/ingest.json')
  await seedArtifact(db, SPLIT_ID, 'director-direct', 'input/direct.json')
  await seedArtifact(
    db,
    SHOT_SCRIPT_ID,
    'director-shot-spec',
    'input/spec.json'
  )
  await seedArtifact(db, CODEGEN_ID, 'render-mp4', 'render/S001.mp4')
}

function node(
  id: string,
  type: 'script-import' | 'shot-split' | 'score' | 'shot-script' | 'shot-codegen',
  stage: 'INGEST' | 'DIRECT' | 'ASSEMBLE' | 'SHOT_SPEC' | 'FABRICATE',
  status: 'queued' | 'succeeded',
  payload: Record<string, unknown> = {}
) {
  return {
    workspaceId: LOCAL_WORKSPACE_ID,
    id,
    projectId: PROJECT_ID,
    logicalKey: payload.laneKey
      ? `shot:${String(payload.laneKey)}:${type}`
      : `global:${type}`,
    type,
    stage,
    status,
    positionX: 0,
    positionY: 0,
    data: { schemaVersion: 1, payload },
  }
}

async function seedArtifact(
  db: Db,
  nodeId: string,
  kind: string,
  storageKey: string
): Promise<void> {
  await db.insert(artifacts).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: randomUUID(),
    projectId: PROJECT_ID,
    aggregateType: 'node',
    aggregateId: nodeId,
    kind,
    version: 1,
    lifecycle: 'draft',
    schemaVersion: 'test/v1',
    storageKey,
    sizeBytes: 1,
    contentHash: HASH,
    attemptId: ATTEMPTS.get(nodeId)!,
  })
}

function seedFiles(): Map<string, Buffer> {
  return new Map([
    [
      'input/ingest.json',
      Buffer.from(
        JSON.stringify({
          scriptUnits: [{ unitId: 'U001', text: '第一句。' }],
        })
      ),
    ],
    [
      'input/direct.json',
      Buffer.from(JSON.stringify({ masterPlan: '导演总纲', styleBible: '风格圣经' })),
    ],
    [
      'input/spec.json',
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          shots: [{ id: 'S001', purpose: 'demo' }],
        })
      ),
    ],
    ['render/S001.mp4', Buffer.from([1])],
  ])
}

function stagedArtifact(
  nodeId: string,
  kind: string
): ArtifactCommitResult {
  const content = '<!doctype html>'
  return {
    id: randomUUID(),
    workspaceId: LOCAL_WORKSPACE_ID,
    projectId: PROJECT_ID,
    aggregateType: 'node',
    aggregateId: nodeId,
    kind,
    schemaVersion: 'cvc.director-artifact/v1',
    storageKey: `staged/${nodeId}.html`,
    sizeBytes: Buffer.byteLength(content),
    contentHash: createHash('sha256').update(content).digest('hex'),
    attemptId: ATTEMPTS.get(nodeId)!,
    storageKeyAlreadyExisted: false,
  }
}
