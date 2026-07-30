import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  canvasEdges,
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { listDirectorFrontierCandidates } from './frontier-reconciliation'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000401'

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'frontier-reconcile',
    name: 'Frontier reconcile',
  })
})

afterAll(async () => {
  await database.close()
})

it('selects only an unattended ready DAG with no active attempt', async () => {
  const readyProjectId = await seedProject({ autopilot: true, downstreamStatus: 'idle' })
  await seedProject({ autopilot: false, downstreamStatus: 'idle' })
  await seedProject({ autopilot: true, downstreamStatus: 'succeeded' })
  await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    activeAttempt: true,
  })

  await expect(listDirectorFrontierCandidates(database.db)).resolves.toEqual([
    { workspaceId: WORKSPACE_ID, projectId: readyProjectId },
  ])
})

it('does not recover a ready project outside the recent crash window', async () => {
  const [clock] = await database.sql<{ now: string | Date }[]>`select now() as now`
  const now = new Date(clock!.now)
  await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    updatedAt: new Date(now.getTime() - 16 * 60 * 1_000),
  })

  await expect(listDirectorFrontierCandidates(database.db)).resolves.toEqual([])
})

it('selects only the most recently updated project when several are recoverable', async () => {
  const [clock] = await database.sql<{ now: string | Date }[]>`select now() as now`
  const now = new Date(clock!.now)
  const olderProjectId = await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    updatedAt: new Date(now.getTime() - 2 * 60 * 1_000),
  })
  const latestProjectId = await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    updatedAt: new Date(now.getTime() - 60 * 1_000),
  })

  expect(olderProjectId).not.toBe(latestProjectId)
  await expect(listDirectorFrontierCandidates(database.db)).resolves.toEqual([
    { workspaceId: WORKSPACE_ID, projectId: latestProjectId },
  ])
})

async function seedProject(input: {
  autopilot: boolean
  downstreamStatus: 'idle' | 'succeeded'
  activeAttempt?: boolean
  updatedAt?: Date
}): Promise<string> {
  const projectId = randomUUID()
  const entryId = randomUUID()
  const downstreamId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '文稿项目',
    script: '真实文稿',
    workflowVersion: 'test',
    workflowKind: 'script',
    autopilot: input.autopilot,
    exportSettings: { schemaVersion: 1 },
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  })
  await database.db.insert(canvasNodes).values([
    {
      workspaceId: WORKSPACE_ID,
      id: entryId,
      projectId,
      logicalKey: 'source:script',
      type: 'script-import',
      stage: 'INGEST',
      status: 'succeeded',
      data: { schemaVersion: 1, payload: {} },
    },
    {
      workspaceId: WORKSPACE_ID,
      id: downstreamId,
      projectId,
      logicalKey: 'director:direct',
      type: 'shot-split',
      stage: 'DIRECT',
      status: input.downstreamStatus,
      data: { schemaVersion: 1, payload: {} },
    },
  ])
  await database.db.insert(canvasEdges).values({
    workspaceId: WORKSPACE_ID,
    projectId,
    source: entryId,
    target: downstreamId,
  })
  const runId = randomUUID()
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    executionEpoch: 0,
    status: input.activeAttempt ? 'queued' : 'succeeded',
    workflowVersion: 'test',
    fingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0'),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: randomUUID(),
    runId,
    taskId: 'director-stage',
    entityType: 'node',
    entityId: entryId,
    attemptNo: 1,
    status: input.activeAttempt ? 'queued' : 'succeeded',
    fingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    checkpoint: { schemaVersion: 1 },
  })
  return projectId
}
