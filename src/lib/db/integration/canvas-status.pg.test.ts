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
  captureNodeInputFingerprint,
  computeContentHash,
  invalidateNodeForRegeneration,
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

  it('clears stale stage errors when a retry finally succeeds', async () => {
    const nodeId = await insertNode(database.db, WORKSPACE_ID, projectId)
    await database.db
      .update(canvasNodes)
      .set({
        data: {
          schemaVersion: 1,
          payload: {
            laneKey: 'S001',
            directorError: { stage: 'SHOT_SPEC', message: '上一次失败' },
            renderError: { message: '上一次渲染失败' },
          },
        },
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )

    await transitionNodeStatus(nodeId, 'pending')
    await transitionNodeStatus(nodeId, 'running')
    await transitionNodeStatus(nodeId, 'success')

    const [node] = await database.db
      .select({ status: canvasNodes.status, data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )
    expect(node?.status).toBe('succeeded')
    expect(node?.data).toEqual({
      schemaVersion: 1,
      payload: { laneKey: 'S001' },
    })
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
    await setPayload(database.db, upstreamId, {
      outputContentHash: 'hash-a',
    })
    const fingerprint = computeContentHash([
      { id: upstreamId, outputContentHash: 'hash-a' },
    ])
    const downstreamId = await insertNode(
      database.db,
      WORKSPACE_ID,
      projectId,
      'downstream-output',
      'succeeded'
    )
    await setPayload(database.db, downstreamId, {
      outputContentHash: 'downstream-output',
      inputFingerprint: fingerprint,
    })
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
      .set({ data: versionedData(null, { outputContentHash: 'hash-b' }) })
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

  it('captures the exact upstream output fingerprint before execution', async () => {
    const upstreamId = await insertNode(database.db, WORKSPACE_ID, projectId)
    const downstreamId = await insertNode(database.db, WORKSPACE_ID, projectId)
    await setPayload(database.db, upstreamId, {
      outputContentHash: 'a'.repeat(64),
    })
    await database.db.insert(canvasEdges).values({
      workspaceId: WORKSPACE_ID,
      id: randomUUID(),
      projectId,
      source: upstreamId,
      target: downstreamId,
    })

    await captureNodeInputFingerprint(downstreamId)

    const [node] = await database.db
      .select({ data: canvasNodes.data })
      .from(canvasNodes)
      .where(eq(canvasNodes.id, downstreamId))
    expect(node?.data.payload).toMatchObject({
      inputFingerprint: computeContentHash([
        { id: upstreamId, outputContentHash: 'a'.repeat(64) },
      ]),
    })
  })

  it('invalidates a successful node for explicit regeneration without faking upstream drift', async () => {
    const nodeId = await insertNode(
      database.db,
      WORKSPACE_ID,
      projectId,
      'hash-a',
      'succeeded'
    )

    await invalidateNodeForRegeneration(nodeId, 'manual-regenerate')

    const [node] = await database.db
      .select({ status: canvasNodes.status, data: canvasNodes.data })
      .from(canvasNodes)
      .where(eq(canvasNodes.id, nodeId))
    expect(node?.status).toBe('stale')
    expect(node?.data.payload).toMatchObject({
      invalidationReason: 'manual-regenerate',
    })
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
      data: versionedData(contentHash),
      status,
    })
  return id
}

function versionedData(
  contentHash: string | null,
  patch: Record<string, unknown> = {}
): {
  schemaVersion: number
  payload: Record<string, unknown>
} {
  return {
    schemaVersion: 1,
    payload: { ...(contentHash ? { contentHash } : {}), ...patch },
  }
}

async function setPayload(
  db: Db,
  nodeId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await db
    .update(canvasNodes)
    .set({ data: versionedData(null, payload) })
    .where(eq(canvasNodes.id, nodeId))
}
