import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
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
import {
  reconcileOrphanedWorkflowLeases,
  reconcileStaleExecutionEpochs,
} from './execution-reconciliation'
import { reconcileExpiredProviderTickets } from '@/features/ai/provider-dispatch-ticket'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000082'

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'execution-reconcile',
    name: 'Execution reconcile',
  })
})

afterAll(async () => {
  await database.close()
})

it('cancels queued attempts fenced by a newer project execution epoch', async () => {
  const projectId = randomUUID()
  const runId = randomUUID()
  const attemptId = randomUUID()
  const nodeId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '旧代次',
    script: '',
    workflowVersion: 'test',
    executionEpoch: 2,
    exportSettings: { schemaVersion: 1 },
  })
  await database.db.insert(canvasNodes).values({
    workspaceId: WORKSPACE_ID,
    id: nodeId,
    projectId,
    logicalKey: 'shot:S001:shot-script',
    type: 'shot-script',
    stage: 'SHOT_SPEC',
    status: 'queued',
    data: { schemaVersion: 1, payload: { laneKey: 'S001' } },
  })
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    executionEpoch: 1,
    status: 'queued',
    workflowVersion: 'test',
    fingerprint: '4'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'legacy.director-stage',
    entityType: 'node',
    entityId: nodeId,
    attemptNo: 1,
    status: 'queued',
    fingerprint: '5'.repeat(64),
    checkpoint: { schemaVersion: 1 },
    workUnitKey: 'S001',
  })
  await database.db.insert(workflowConcurrencyLeases).values({
    workspaceId: WORKSPACE_ID,
    projectId,
    workUnitKey: 'S001',
    planKey: 'free',
    status: 'waiting',
  })
  await database.db.insert(providerDispatches).values({
    id: randomUUID(),
    scopeKey: '6'.repeat(64),
    workspaceId: WORKSPACE_ID,
    attemptId,
    provider: 'stepfun',
    funding: 'managed',
    status: 'scheduled',
    leaseExpiresAt: new Date(Date.now() + 60_000),
  })

  await expect(reconcileStaleExecutionEpochs(database.db)).resolves.toEqual([attemptId])
  expect((await database.db.select().from(taskAttempts))[0]?.status).toBe('cancelled')
  expect((await database.db.select().from(pipelineRuns))[0]?.status).toBe('cancelled')
  expect((await database.db.select().from(canvasNodes))[0]?.status).toBe('cancelled')
  expect((await database.db.select().from(workflowConcurrencyLeases))[0]?.status)
    .toBe('cancelled')
  expect((await database.db.select().from(providerDispatches))[0]?.status)
    .toBe('cancelled')
})

it('cancels waiting and active workflow leases without an active parent attempt', async () => {
  const projectId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '孤儿租约',
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1 },
  })
  await database.db.insert(workflowConcurrencyLeases).values([
    {
      workspaceId: WORKSPACE_ID,
      projectId,
      workUnitKey: 'waiting-orphan',
      planKey: 'free',
      status: 'waiting',
    },
    {
      workspaceId: WORKSPACE_ID,
      projectId,
      workUnitKey: 'active-orphan',
      planKey: 'free',
      status: 'active',
      leaseExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    },
  ])

  await expect(reconcileOrphanedWorkflowLeases(database.db)).resolves.toBe(2)
  await expect(reconcileOrphanedWorkflowLeases(database.db)).resolves.toBe(0)
  const leases = await database.db.select().from(workflowConcurrencyLeases)
  expect(leases.map(({ status }) => status)).toEqual(['cancelled', 'cancelled'])
})

it('keeps current-epoch leases and cancels leases owned only by an old epoch', async () => {
  const projectId = randomUUID()
  const runId = randomUUID()
  const attemptId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '租约代次隔离',
    script: '',
    workflowVersion: 'test',
    executionEpoch: 1,
    exportSettings: { schemaVersion: 1 },
  })
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    executionEpoch: 1,
    status: 'running',
    workflowVersion: 'test',
    fingerprint: '7'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'legacy.director-stage',
    entityType: 'project',
    entityId: projectId,
    attemptNo: 1,
    status: 'running',
    fingerprint: '8'.repeat(64),
    checkpoint: { schemaVersion: 1 },
    workUnitKey: 'S001',
  })
  await database.db.insert(workflowConcurrencyLeases).values({
    workspaceId: WORKSPACE_ID,
    projectId,
    workUnitKey: 'S001',
    planKey: 'free',
    status: 'active',
    leaseExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
  })
  await database.db.insert(providerDispatches).values({
    id: randomUUID(),
    scopeKey: '9'.repeat(64),
    workspaceId: WORKSPACE_ID,
    attemptId,
    provider: 'stepfun',
    funding: 'managed',
    status: 'in_flight',
    leaseExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
  })

  await expect(reconcileOrphanedWorkflowLeases(database.db)).resolves.toBe(0)
  await expect(reconcileExpiredProviderTickets(database.db)).resolves.toBe(0)
  await database.db.update(projects).set({ executionEpoch: 2 })
  await expect(reconcileOrphanedWorkflowLeases(database.db)).resolves.toBe(1)
  await expect(reconcileExpiredProviderTickets(database.db)).resolves.toBe(1)
  expect((await database.db.select().from(workflowConcurrencyLeases))[0]?.status)
    .toBe('cancelled')
  expect((await database.db.select().from(providerDispatches))[0]?.status)
    .toBe('cancelled')
})
