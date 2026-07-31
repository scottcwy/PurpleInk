import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInAuthContext, SYSTEM_USER_ID } from '@/lib/auth/workspace-context'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  providerDispatches,
  taskAttempts,
  workflowConcurrencyLeases,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { stopProjectExecution } from './project-execution-stop'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000081'

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'project-stop',
    name: 'Project stop',
  })
})

afterAll(async () => {
  await database.close()
})

describe('stopProjectExecution', () => {
  it('fences and cancels queued work atomically without touching artifacts', async () => {
    const fixture = await seedExecution('queued')
    const result = await inWorkspace(() => stopProjectExecution(fixture.projectId, {
      database: database.db,
      releaseReservation: vi.fn(async () => undefined),
    }))

    expect(result).toEqual({
      autopilot: false,
      status: 'stopped',
      cancelledAttempts: 1,
      cancelledRuns: 1,
      cancelledTickets: 1,
      cancelledLeases: 1,
      remainingRunning: 0,
    })
    const [project] = await database.db.select().from(projects)
    const [run] = await database.db.select().from(pipelineRuns)
    const [attempt] = await database.db.select().from(taskAttempts)
    const [lease] = await database.db.select().from(workflowConcurrencyLeases)
    const [ticket] = await database.db.select().from(providerDispatches)
    const [node] = await database.db.select().from(canvasNodes)
    expect(project).toMatchObject({ autopilot: false, executionEpoch: 1 })
    expect(run?.status).toBe('cancelled')
    expect(attempt).toMatchObject({ status: 'cancelled', leaseExpiresAt: null })
    expect(attempt?.cancelRequestedAt).toBeInstanceOf(Date)
    expect(lease?.status).toBe('cancelled')
    expect(ticket?.status).toBe('cancelled')
    expect(node?.status).toBe('cancelled')

    const repeated = await inWorkspace(() => stopProjectExecution(fixture.projectId, {
      database: database.db,
      releaseReservation: vi.fn(async () => undefined),
    }))
    expect(repeated).toMatchObject({
      status: 'stopped',
      cancelledAttempts: 0,
      cancelledRuns: 0,
      remainingRunning: 0,
    })
    const [sameProject] = await database.db.select().from(projects)
    expect(sameProject?.executionEpoch).toBe(1)
  })

  it('requests cooperative cancellation while preserving in-flight ownership', async () => {
    const fixture = await seedExecution('running')
    const result = await inWorkspace(() => stopProjectExecution(fixture.projectId, {
      database: database.db,
      releaseReservation: vi.fn(async () => undefined),
    }))

    expect(result).toMatchObject({
      status: 'stopping',
      cancelledAttempts: 0,
      cancelledTickets: 0,
      cancelledLeases: 0,
      remainingRunning: 1,
    })
    const [attempt] = await database.db.select().from(taskAttempts)
    const [lease] = await database.db.select().from(workflowConcurrencyLeases)
    const [ticket] = await database.db.select().from(providerDispatches)
    expect(attempt).toMatchObject({ status: 'running' })
    expect(attempt?.cancelRequestedAt).toBeInstanceOf(Date)
    expect(lease?.status).toBe('active')
    expect(ticket?.status).toBe('in_flight')
  })
})

async function seedExecution(status: 'queued' | 'running') {
  const projectId = randomUUID()
  const runId = randomUUID()
  const attemptId = randomUUID()
  const nodeId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '停止测试',
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1 },
    autopilot: true,
  })
  await database.db.insert(canvasNodes).values({
    workspaceId: WORKSPACE_ID,
    id: nodeId,
    projectId,
    logicalKey: 'shot:S001:shot-script',
    type: 'shot-script',
    stage: 'SHOT_SPEC',
    status,
    data: {
      schemaVersion: 1,
      payload: { laneKey: 'S001', laneRole: 'shot-script' },
    },
  })
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    status,
    workflowVersion: 'test',
    fingerprint: '1'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'legacy.director-stage',
    entityType: 'node',
    entityId: nodeId,
    attemptNo: 1,
    status,
    fingerprint: '2'.repeat(64),
    checkpoint: { schemaVersion: 1 },
    workUnitKey: 'S001',
    leaseExpiresAt: status === 'running' ? new Date(Date.now() + 60_000) : null,
  })
  await database.db.insert(workflowConcurrencyLeases).values({
    workspaceId: WORKSPACE_ID,
    projectId,
    workUnitKey: 'S001',
    planKey: 'free',
    status: status === 'running' ? 'active' : 'waiting',
    leaseExpiresAt: status === 'running' ? new Date(Date.now() + 60_000) : null,
  })
  await database.db.insert(providerDispatches).values({
    id: randomUUID(),
    scopeKey: '3'.repeat(64),
    workspaceId: WORKSPACE_ID,
    attemptId,
    provider: 'stepfun',
    funding: 'managed',
    status: status === 'running' ? 'in_flight' : 'scheduled',
    startedAt: status === 'running' ? new Date() : null,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  })
  return { projectId, runId, attemptId, nodeId }
}

function inWorkspace<T>(operation: () => Promise<T>): Promise<T> {
  return runInAuthContext(
    { workspaceId: WORKSPACE_ID, userId: SYSTEM_USER_ID },
    operation,
  )
}
