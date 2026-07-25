import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db/client'
import {
  artifacts,
  canvasEdges,
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
import {
  getCanvasGraph,
  getNodeArtifacts,
  getNodeStreamContext,
  listProjects,
} from '@/features/canvas/queries'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn<() => Promise<Db>>(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({
  getDb: getDbMock,
  LOCAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
}))

let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  getDbMock.mockResolvedValue(database.db)
})

afterAll(async () => {
  await database.close()
})

describe('getCanvasGraph', () => {
  it('returns only nodes and edges in the trusted workspace and project', async () => {
    const projectId = randomUUID()
    await seedProject(database.db, WORKSPACE_ID, '目标项目', projectId)
    await seedProject(database.db, OTHER_WORKSPACE_ID, '同 ID 其他项目', projectId)
    const localNode = await seedNode(database.db, WORKSPACE_ID, projectId)
    const foreignNode = await seedNode(
      database.db,
      OTHER_WORKSPACE_ID,
      projectId
    )
    await seedEdge(database.db, WORKSPACE_ID, projectId, localNode)
    await seedEdge(database.db, OTHER_WORKSPACE_ID, projectId, foreignNode)

    const result = getCanvasGraph(projectId)
    expect(result).toBeInstanceOf(Promise)
    const graph = await result
    expect(graph.nodes.map(({ id }) => id)).toEqual([localNode])
    expect(graph.edges).toHaveLength(1)
  })

  it('unwraps versioned data and maps persisted status and lane metadata', async () => {
    const projectId = await seedProject(
      database.db,
      WORKSPACE_ID,
      '分镜项目'
    )
    const nodeId = await seedNode(database.db, WORKSPACE_ID, projectId, {
      type: 'shot-codegen',
      stage: 'FABRICATE',
      status: 'succeeded',
      payload: {
        contentHash: 'real-hash-value',
        laneKey: 'S001',
        laneRole: 'shot-codegen',
        sourceUnit: { unitId: 'U001', text: '第一段真实脚本', order: 0 },
      },
    })

    const node = (await getCanvasGraph(projectId)).nodes[0]
    expect(node).toMatchObject({
      id: nodeId,
      status: 'success',
      contentHash: 'real-hash-value',
      laneKey: 'S001',
      laneRole: 'shot-codegen',
      data: {
        sourceUnit: { unitId: 'U001', text: '第一段真实脚本', order: 0 },
      },
    })
  })

  it('derives typed directorError from the unwrapped node payload', async () => {
    const projectId = await seedProject(
      database.db,
      WORKSPACE_ID,
      '错误项目'
    )
    await seedNode(database.db, WORKSPACE_ID, projectId, {
      status: 'failed',
      payload: {
        directorError: { stage: 'DIRECT', message: '风格圣经解析失败' },
      },
    })

    expect((await getCanvasGraph(projectId)).nodes[0]?.directorError).toEqual({
      stage: 'DIRECT',
      message: '风格圣经解析失败',
    })
  })
})

describe('artifact and stream projections', () => {
  it('returns real canvas-node artifacts, newest first, without internal pointers', async () => {
    const projectId = await seedProject(
      database.db,
      WORKSPACE_ID,
      '产物项目'
    )
    const nodeId = await seedNode(database.db, WORKSPACE_ID, projectId)
    const attemptId = await seedAttempt(database.db, projectId)
    await insertArtifact(database.db, {
      projectId,
      nodeId,
      attemptId,
      kind: 'pi-session',
      storageKey: 'pi-sessions/session.jsonl',
      version: 1,
      createdAt: new Date(1000),
    })
    await insertArtifact(database.db, {
      projectId,
      nodeId,
      attemptId,
      kind: 'director-ingest',
      storageKey: 'director/ingest-1.json',
      version: 1,
      createdAt: new Date(2000),
    })
    const newestId = await insertArtifact(database.db, {
      projectId,
      nodeId,
      attemptId,
      kind: 'director-ingest',
      storageKey: 'director/ingest-2.json',
      version: 2,
      createdAt: new Date(3000),
    })

    const rows = await getNodeArtifacts(projectId, nodeId)
    expect(rows).toEqual([
      {
        id: newestId,
        kind: 'director-ingest',
        filename: 'ingest-2.json',
      },
      {
        id: expect.any(String),
        kind: 'director-ingest',
        filename: 'ingest-1.json',
      },
    ])
    expect((await getCanvasGraph(projectId)).nodes[0]?.artifacts).toEqual(rows)
  })

  it('requires both trusted workspace and project ownership for stream context', async () => {
    const projectId = randomUUID()
    await seedProject(database.db, WORKSPACE_ID, '本地项目', projectId)
    await seedProject(database.db, OTHER_WORKSPACE_ID, '其他项目', projectId)
    const localNode = await seedNode(database.db, WORKSPACE_ID, projectId, {
      status: 'cancelled',
    })
    const foreignNode = await seedNode(
      database.db,
      OTHER_WORKSPACE_ID,
      projectId,
      {
        status: 'failed',
        payload: {
          directorError: { stage: 'DIRECT', message: '不应跨 workspace 暴露' },
        },
      }
    )

    await expect(getNodeStreamContext(projectId, localNode)).resolves.toEqual({
      status: 'cancelled',
      directorError: undefined,
    })
    await expect(
      getNodeStreamContext(projectId, foreignNode)
    ).resolves.toBeNull()
  })
})

it('listProjects excludes projects from other workspaces', async () => {
  await seedProject(database.db, WORKSPACE_ID, '本地项目')
  await seedProject(database.db, OTHER_WORKSPACE_ID, '其他项目')
  await expect(listProjects()).resolves.toMatchObject([{ title: '本地项目' }])
})

async function seedProject(
  db: Db,
  workspaceId: string,
  title: string,
  id = randomUUID()
): Promise<string> {
  await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      slug: `workspace-${workspaceId}`,
      name: title,
    })
    .onConflictDoNothing()
  await db.insert(projects).values({
    workspaceId,
    id,
    title,
    script: '',
    workflowVersion: 'canvas-test-v1',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  return id
}

async function seedNode(
  db: Db,
  workspaceId: string,
  projectId: string,
  overrides: {
    type?: string
    stage?: string
    status?: string
    payload?: Record<string, unknown>
  } = {}
): Promise<string> {
  const id = randomUUID()
  await db.insert(canvasNodes).values({
    workspaceId,
    id,
    projectId,
    logicalKey: `test:${id}`,
    type: overrides.type ?? 'shot-split',
    stage: overrides.stage ?? 'DIRECT',
    status: overrides.status ?? 'idle',
    positionX: 0,
    positionY: 0,
    data: { schemaVersion: 1, payload: overrides.payload ?? {} },
  })
  return id
}

async function seedEdge(
  db: Db,
  workspaceId: string,
  projectId: string,
  nodeId: string
): Promise<void> {
  await db.insert(canvasEdges).values({
    workspaceId,
    id: randomUUID(),
    projectId,
    source: nodeId,
    target: nodeId,
  })
}

async function seedAttempt(db: Db, projectId: string): Promise<string> {
  const runId = randomUUID()
  const attemptId = randomUUID()
  await db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    status: 'queued',
    workflowVersion: 'canvas-test-v1',
    fingerprint: 'a'.repeat(64),
  })
  await db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'cvc.project.plan',
    entityType: 'project',
    entityId: projectId,
    attemptNo: 1,
    status: 'queued',
    fingerprint: 'b'.repeat(64),
    checkpoint: { schemaVersion: 1 },
  })
  return attemptId
}

async function insertArtifact(
  db: Db,
  input: {
    projectId: string
    nodeId: string
    attemptId: string
    kind: string
    storageKey: string
    version: number
    createdAt: Date
  }
): Promise<string> {
  const id = randomUUID()
  await db.insert(artifacts).values({
    workspaceId: WORKSPACE_ID,
    id,
    projectId: input.projectId,
    aggregateType: 'node',
    aggregateId: input.nodeId,
    kind: input.kind,
    version: input.version,
    lifecycle: 'draft',
    schemaVersion: 'cvc.canvas-test/v1',
    storageKey: input.storageKey,
    sizeBytes: 1,
    contentHash: 'c'.repeat(64),
    attemptId: input.attemptId,
    createdAt: input.createdAt,
  })
  return id
}
