import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { materializeShotLanes } from '@/features/canvas/fan-out'

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

describe('materializeShotLanes', () => {
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

  it('returns a Promise and creates five ordered nodes with six edges per shot', async () => {
    const result = materializeShotLanes(projectId, [
      'shot-1',
      'shot-2',
      'shot-3',
    ])
    expect(result).toBeInstanceOf(Promise)
    await result

    const laneNodes = (await database.db.select().from(canvasNodes)).filter(
      (node) => node.logicalKey.startsWith('shot:')
    )
    expect(laneNodes).toHaveLength(15)
    expect(await database.db.select().from(canvasEdges)).toHaveLength(18)

    const firstLane = laneNodes.filter((node) =>
      node.logicalKey.startsWith('shot:shot-1:')
    )
    expect(firstLane.map((node) => readPayload(node.data).laneRole)).toEqual([
      'shot-script',
      'shot-codegen',
      'shot-sfx',
      'shot-subtitle',
      'shot-qa',
    ])
    expect(firstLane.map((node) => node.stage)).toEqual([
      'SHOT_SPEC',
      'FABRICATE',
      'ASSEMBLE',
      'ASSEMBLE',
      'FINALIZE',
    ])
  })

  it('rolls back every write when a mid-transaction insert fails', async () => {
    await database.sql`
      CREATE FUNCTION fail_shot_sfx() RETURNS trigger AS $$
      BEGIN
        IF NEW.logical_key LIKE '%:shot-sfx' THEN
          RAISE EXCEPTION 'injected lane failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `
    await database.sql`
      CREATE TRIGGER fail_shot_sfx
      BEFORE INSERT ON canvas_nodes
      FOR EACH ROW EXECUTE FUNCTION fail_shot_sfx()
    `

    await expect(
      materializeShotLanes(projectId, ['shot-fails'])
    ).rejects.toThrow()
    expect(
      (await database.db.select().from(canvasNodes)).filter((node) =>
        node.logicalKey.startsWith('shot:')
      )
    ).toHaveLength(0)
    expect(await database.db.select().from(canvasEdges)).toHaveLength(0)
  })

  it('is idempotent for an already materialized shot batch', async () => {
    const shotIds = ['shot-1', 'shot-2', 'shot-3']
    await materializeShotLanes(projectId, shotIds)
    await materializeShotLanes(projectId, shotIds)

    expect(
      (await database.db.select().from(canvasNodes)).filter((node) =>
        node.logicalKey.startsWith('shot:')
      )
    ).toHaveLength(15)
    expect(await database.db.select().from(canvasEdges)).toHaveLength(18)
  })

  it('persists validated INGEST source units on every lane node', async () => {
    await materializeShotLanes(projectId, [
      {
        shotId: 'S001',
        sourceUnit: { unitId: 'U001', text: '第一段原稿', order: 0 },
      },
    ])

    const laneNodes = (await database.db.select().from(canvasNodes)).filter(
      (node) => node.logicalKey.startsWith('shot:S001:')
    )
    expect(laneNodes).toHaveLength(5)
    for (const node of laneNodes) {
      expect(readPayload(node.data)).toMatchObject({
        laneKey: 'S001',
        sourceUnitId: 'U001',
        sourceUnit: { unitId: 'U001', text: '第一段原稿', order: 0 },
      })
    }
  })

  it('never reads or writes a same-id project in another workspace', async () => {
    await seedProject(database.db, OTHER_WORKSPACE_ID, projectId)
    await materializeShotLanes(projectId, ['S-isolated'])

    const allNodes = await database.db.select().from(canvasNodes)
    expect(
      allNodes.filter(
        (node) =>
          node.workspaceId === OTHER_WORKSPACE_ID &&
          node.logicalKey.startsWith('shot:')
      )
    ).toHaveLength(0)
    expect(
      allNodes.filter(
        (node) =>
          node.workspaceId === WORKSPACE_ID &&
          node.logicalKey.startsWith('shot:')
      )
    ).toHaveLength(5)
  })
})

async function seedProject(
  db: Db,
  workspaceId: string,
  projectId: string
): Promise<void> {
  await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      slug: `workspace-${workspaceId}`,
      name: 'Canvas Test',
    })
  await db.insert(projects).values({
    workspaceId,
    id: projectId,
    title: '分镜物化测试',
    script: '',
    workflowVersion: 'canvas-test-v1',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  await db.insert(canvasNodes).values([
    globalNode(workspaceId, projectId, 'shot-split', 'DIRECT'),
    globalNode(workspaceId, projectId, 'score', 'ASSEMBLE'),
  ])
}

function globalNode(
  workspaceId: string,
  projectId: string,
  type: 'shot-split' | 'score',
  stage: 'DIRECT' | 'ASSEMBLE'
): typeof canvasNodes.$inferInsert {
  return {
    workspaceId,
    id: randomUUID(),
    projectId,
    logicalKey: `global:${type}`,
    type,
    stage,
    positionX: 0,
    positionY: 0,
    data: { schemaVersion: 1, payload: {} },
  }
}

function readPayload(value: unknown): Record<string, unknown> {
  return (value as { payload: Record<string, unknown> }).payload
}
