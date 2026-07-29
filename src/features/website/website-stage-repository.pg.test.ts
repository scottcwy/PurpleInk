import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { canvasNodes, projects, workspaces } from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { WEBSITE_WORKFLOW_PHASES } from './website-stage-contract'
import { PostgresWebsiteStageProjector } from './website-stage-repository'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'website-stages',
    name: 'Website stages',
  })
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: PROJECT_ID,
    title: '网站介绍',
    script: '',
    workflowKind: 'website',
    workflowVersion: 'website:1.0.0',
    exportSettings: { schemaVersion: 1 },
  })
  await seedNodes()
})

afterAll(async () => {
  await database.close()
})

describe('PostgresWebsiteStageProjector', () => {
  it('commits final statuses, artifact, and degraded verification together', async () => {
    await projector().complete(PROJECT_ID, {
      artifactId: '00000000-0000-4000-8000-000000000901',
      contentHash: 'a'.repeat(64),
      sizeBytes: 2048,
      durationSec: 30,
      durationSource: 'output',
      elapsedSec: 42,
      verification: {
        checkPassed: false,
        goldenVerified: true,
        goldenCheckCount: 5,
        outcome: 'degraded',
      },
    })

    const nodes = await readNodes()
    expect(nodes.every((node) => node.status === 'succeeded')).toBe(true)
    expect(execution(nodes, 'website:render')).toMatchObject({
      state: 'succeeded',
      verification: { outcome: 'degraded', checkPassed: false },
    })
    expect(execution(nodes, 'website:export')).toMatchObject({
      enginePhase: 'done',
      elapsedSec: 42,
      artifact: { contentHash: 'a'.repeat(64), sizeBytes: 2048 },
      verification: { outcome: 'degraded' },
    })
  })

  it('uses failed plus cancelled terminals without a confirmation workflowBlock', async () => {
    await projector().fail(PROJECT_ID, 'capture', 'WEBSITE_ENGINE_UNAVAILABLE')

    const nodes = await readNodes()
    expect(nodes.map((node) => node.status)).toEqual([
      'failed',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
    ])
    expect(nodes.every((node) => !('workflowBlock' in payload(node)))).toBe(true)
  })

  it('rolls back earlier status writes when any projection in the batch is invalid', async () => {
    const script = (await readNodes()).find(
      (node) => node.logicalKey === 'website:script',
    )!
    await database.db.update(canvasNodes).set({
      data: { schemaVersion: 1 },
    }).where(eq(canvasNodes.id, script.id))

    await expect(projector().progress(PROJECT_ID, {
      phase: 'script',
      enginePhase: 'scripting',
      state: 'running',
      durationSec: 30,
      durationSource: 'request',
      elapsedSec: 2,
      verification: null,
    })).rejects.toThrow()

    expect((await readNodes()).map((node) => node.status)).toEqual(
      WEBSITE_WORKFLOW_PHASES.map(() => 'idle'),
    )
  })
})

function projector(): PostgresWebsiteStageProjector {
  return new PostgresWebsiteStageProjector(database.db, WORKSPACE_ID)
}

async function seedNodes(): Promise<void> {
  await database.db.insert(canvasNodes).values(WEBSITE_WORKFLOW_PHASES.map((phase) => ({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    logicalKey: `website:${phase}`,
    type: 'website-stage',
    stage: phase === 'export' ? 'FINALIZE' : 'INGEST',
    status: 'idle',
    data: { schemaVersion: 1, payload: { phase } },
  })))
}

async function readNodes() {
  const rows = await database.db.select().from(canvasNodes)
  const order = new Map(WEBSITE_WORKFLOW_PHASES.map((phase, index) => [
    `website:${phase}`,
    index,
  ]))
  return rows.sort((left, right) =>
    order.get(left.logicalKey)! - order.get(right.logicalKey)!)
}

function execution(
  nodes: Awaited<ReturnType<typeof readNodes>>,
  logicalKey: string,
): Record<string, unknown> {
  const node = nodes.find((candidate) => candidate.logicalKey === logicalKey)!
  return payload(node).websiteExecution as Record<string, unknown>
}

function payload(
  node: Awaited<ReturnType<typeof readNodes>>[number],
): Record<string, unknown> {
  const value = node.data.payload
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('测试节点 payload 无效')
  }
  return value as Record<string, unknown>
}
