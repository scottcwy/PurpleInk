import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  canvasEdges,
  canvasNodes,
  projects,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import {
  computeContentHash,
  isStale,
  transitionNodeStatus,
} from '@/features/canvas/status'

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

describe('canvas node status', () => {
  let database: PgTestDatabase
  let projectId: string

  beforeAll(async () => {
    database = await createPgTestDatabase()
  })

  beforeEach(async () => {
    await database.reset()
    projectId = randomUUID()
    getDbMock.mockResolvedValue(database.db)
    await seedProject(database.db, WORKSPACE_ID, projectId)
  })

  afterAll(async () => {
    await database.close()
  })

  it('returns a Promise and rejects an illegal idle to success transition', async () => {
    const nodeId = await insertNode(database.db, WORKSPACE_ID, projectId)
    const result = transitionNodeStatus(nodeId, 'success')
    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toThrow(
      '非法节点状态转换：idle -> success'
    )
  })

  it('maps the legacy pending/success lifecycle to queued/succeeded', async () => {
    const nodeId = await insertNode(database.db, WORKSPACE_ID, projectId)
    await transitionNodeStatus(nodeId, 'pending')
    await transitionNodeStatus(nodeId, 'running')
    await transitionNodeStatus(nodeId, 'success')

    const [node] = await database.db
      .select()
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )
    expect(node?.status).toBe('succeeded')
  })

  it('persists cancellation without disguising it as failure', async () => {
    const nodeId = await insertNode(database.db, WORKSPACE_ID, projectId)
    await transitionNodeStatus(nodeId, 'pending')
    await transitionNodeStatus(nodeId, 'cancelled')

    const [node] = await database.db
      .select({ status: canvasNodes.status })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )
    expect(node?.status).toBe('cancelled')
  })

  it('produces the same hash for semantically identical serializable input', () => {
    expect(computeContentHash({ b: 2, a: { y: 1, x: 0 } })).toBe(
      computeContentHash({ a: { x: 0, y: 1 }, b: 2 })
    )
  })

  it('becomes stale only after an upstream content hash changes', async () => {
    const upstreamId = await insertNode(
      database.db,
      WORKSPACE_ID,
      projectId,
      'hash-a'
    )
    const fingerprint = computeContentHash([{ id: upstreamId, contentHash: 'hash-a' }])
    const downstreamId = await insertNode(
      database.db,
      WORKSPACE_ID,
      projectId,
      fingerprint,
      'succeeded'
    )
    await database.db
      .insert(canvasEdges)
      .values({
        workspaceId: WORKSPACE_ID,
        id: randomUUID(),
        projectId,
        source: upstreamId,
        target: downstreamId,
      })

    await expect(isStale(downstreamId)).resolves.toBe(false)
    await database.db
      .update(canvasNodes)
      .set({ data: versionedData('hash-b') })
      .where(
        and(
          eq(canvasNodes.workspaceId, WORKSPACE_ID),
          eq(canvasNodes.id, upstreamId)
        )
      )
    await expect(isStale(downstreamId)).resolves.toBe(true)
    await transitionNodeStatus(downstreamId, 'stale')
    expect(
      (
        await database.db
        .select({ status: canvasNodes.status })
        .from(canvasNodes)
          .where(
            and(
              eq(canvasNodes.workspaceId, WORKSPACE_ID),
              eq(canvasNodes.id, downstreamId)
            )
          )
      )[0]?.status
    ).toBe('stale')
  })

  it('updates only the trusted workspace when the node id is shared', async () => {
    const sharedNodeId = randomUUID()
    await seedProject(database.db, OTHER_WORKSPACE_ID, projectId)
    await insertNode(
      database.db,
      WORKSPACE_ID,
      projectId,
      null,
      'idle',
      sharedNodeId
    )
    await insertNode(
      database.db,
      OTHER_WORKSPACE_ID,
      projectId,
      null,
      'idle',
      sharedNodeId
    )

    await transitionNodeStatus(sharedNodeId, 'pending')
    const rows = await database.db
      .select({
        workspaceId: canvasNodes.workspaceId,
        status: canvasNodes.status,
      })
      .from(canvasNodes)
      .where(eq(canvasNodes.id, sharedNodeId))
    expect(rows).toEqual(
      expect.arrayContaining([
        { workspaceId: WORKSPACE_ID, status: 'queued' },
        { workspaceId: OTHER_WORKSPACE_ID, status: 'idle' },
      ])
    )
  })
})

async function seedProject(
  db: Db,
  workspaceId: string,
  projectId: string
): Promise<void> {
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `workspace-${workspaceId}`,
    name: 'Status Test',
  })
  await db.insert(projects).values({
    workspaceId,
    id: projectId,
    title: '状态机测试',
    script: '',
    workflowVersion: 'canvas-test-v1',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
}

async function insertNode(
  db: Db,
  workspaceId: string,
  projectId: string,
  contentHash: string | null = null,
  status: 'idle' | 'succeeded' = 'idle',
  id = randomUUID()
): Promise<string> {
  await db
    .insert(canvasNodes)
    .values({
      workspaceId,
      id,
      projectId,
      logicalKey: `test:${id}`,
      type: 'shot-script',
      stage: 'SHOT_SPEC',
      positionX: 0,
      positionY: 0,
      data: versionedData(contentHash),
      status,
    })
  return id
}

function versionedData(contentHash: string | null): {
  schemaVersion: number
  payload: Record<string, unknown>
} {
  return {
    schemaVersion: 1,
    payload: contentHash ? { contentHash } : {},
  }
}
