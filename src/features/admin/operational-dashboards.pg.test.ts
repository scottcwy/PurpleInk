import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiAccessCounters,
  authThrottle,
  pipelineRuns,
  projects,
  providerDispatchCooldowns,
  providerDispatches,
  providerPoolStates,
  sessions,
  taskAttempts,
  users,
  workflowConcurrencyLeases,
  workspaces,
} from '@/lib/db/schema'
import { createPgTestDatabase, type PgTestDatabase } from '@/lib/db/test/pg-test-database'

const getDbMock = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})

const database = {} as PgTestDatabase

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
})
afterAll(async () => database.close())

async function seedWorkflow() {
  const [user] = await database.db.insert(users).values({
    email: 'operator@example.com',
    name: 'Operator',
    passwordHash: 'test-only-password-hash',
  }).returning({ id: users.id })
  const [workspace] = await database.db.insert(workspaces).values({
    slug: 'admin-ops-test',
    name: 'Admin Ops Test',
  }).returning({ id: workspaces.id })
  if (!user || !workspace) throw new Error('seed identity failed')
  const [project] = await database.db.insert(projects).values({
    workspaceId: workspace.id,
    title: 'Projection test',
    script: 'test',
    workflowVersion: 'v3',
    exportSettings: { schemaVersion: 1 },
  }).returning({ id: projects.id })
  if (!project) throw new Error('seed project failed')
  const [run] = await database.db.insert(pipelineRuns).values({
    workspaceId: workspace.id,
    projectId: project.id,
    requestedByUserId: user.id,
    status: 'failed',
    workflowVersion: 'v3',
    fingerprint: '0'.repeat(64),
  }).returning({ id: pipelineRuns.id })
  if (!run) throw new Error('seed run failed')
  const [attempt] = await database.db.insert(taskAttempts).values({
    workspaceId: workspace.id,
    runId: run.id,
    taskId: 'DIRECT',
    entityType: 'canvas_node',
    entityId: project.id,
    attemptNo: 1,
    status: 'failed',
    fingerprint: '1'.repeat(64),
    checkpoint: { schemaVersion: 1 },
    failure: {
      schemaVersion: 1,
      kind: 'provider_rate_limit',
      message: 'secret provider response and user@example.com',
    },
  }).returning({ id: taskAttempts.id })
  if (!attempt) throw new Error('seed attempt failed')
  return { user, workspace, project, run, attempt }
}

describe('admin operational PostgreSQL projections', () => {
  it('aggregates overview and anonymous security counters', async () => {
    const { user, workspace } = await seedWorkflow()
    await database.db.insert(sessions).values({
      tokenHash: '2'.repeat(64),
      userId: user.id,
      workspaceId: workspace.id,
      expiresAt: new Date('2100-01-01T00:00:00.000Z'),
    })
    await database.db.insert(apiAccessCounters).values({
      routeGroup: 'projects',
      outcome: '2xx',
      bucketStartedAt: new Date(),
      count: 4,
    })
    await database.db.insert(authThrottle).values([
      { key: `ip:${'3'.repeat(64)}:login`, count: 2 },
      {
        key: `ip:${'5'.repeat(64)}:login`,
        count: 99,
        windowStartedAt: new Date('2000-01-01T00:00:00.000Z'),
      },
    ])

    const { getAdminOverview } = await import('./overview-repository')
    const { getAdminDauMetrics } = await import('./metrics-repository')
    const { getAdminSecuritySnapshot } = await import('./security-repository')
    const overview = await getAdminOverview()
    const metrics = await getAdminDauMetrics(7)
    const security = await getAdminSecuritySnapshot()

    expect(overview).toMatchObject({ users: { total: 1, active: 1, disabled: 0 }, activeSessions: 1 })
    expect(metrics).toMatchObject({ totalUsers: 1, dauToday: 1, wau: 1, mau: 1 })
    expect(security.apiAccess).toEqual([{ routeGroup: 'projects', outcome: '2xx', count: 4 }])
    expect(security.authThrottle).toEqual({ trackedBuckets: 1, attempts: 2 })
    expect(JSON.stringify(security)).not.toContain('ip:')
  })

  it('projects real attempts safely and observes current lease/dispatch state', async () => {
    const { workspace, project, run, attempt } = await seedWorkflow()
    await database.db.insert(taskAttempts).values([
      {
        workspaceId: workspace.id,
        runId: run.id,
        taskId: 'queued-work',
        entityType: 'canvas_node',
        entityId: project.id,
        attemptNo: 1,
        status: 'queued',
        fingerprint: '6'.repeat(64),
        checkpoint: { schemaVersion: 1 },
      },
      {
        workspaceId: workspace.id,
        runId: run.id,
        taskId: 'expired-running-work',
        entityType: 'canvas_node',
        entityId: project.id,
        attemptNo: 1,
        status: 'running',
        leaseExpiresAt: new Date('2000-01-01T00:00:00.000Z'),
        fingerprint: '8'.repeat(64),
        checkpoint: { schemaVersion: 1 },
      },
    ])
    await database.db.insert(workflowConcurrencyLeases).values({
      workspaceId: workspace.id,
      workUnitKey: 'shot-1',
      projectId: project.id,
      planKey: 'free',
      status: 'waiting',
    })
    await database.db.insert(providerDispatches).values({
      scopeKey: '4'.repeat(64),
      workspaceId: workspace.id,
      attemptId: attempt.id,
      provider: 'safe-provider',
      funding: 'managed',
      status: 'scheduled',
      leaseExpiresAt: new Date('2100-01-01T00:00:00.000Z'),
    })
    await database.db.insert(providerDispatchCooldowns).values({
      scopeKey: '4'.repeat(64),
      provider: 'safe-provider',
      blockedUntil: new Date('2100-01-01T00:00:00.000Z'),
    })
    await database.db.insert(providerPoolStates).values({
      scopeKey: '4'.repeat(64),
      provider: 'safe-provider',
      currentConcurrency: 2,
      maxConcurrency: 8,
      failureCount: 1,
    })
    await database.db.insert(workflowConcurrencyLeases).values({
      workspaceId: workspace.id,
      workUnitKey: 'historical-shot',
      projectId: project.id,
      planKey: 'free',
      status: 'released',
    })
    await database.db.insert(workflowConcurrencyLeases).values({
      workspaceId: workspace.id,
      workUnitKey: 'expired-active-shot',
      projectId: project.id,
      planKey: 'free',
      status: 'active',
      leaseExpiresAt: new Date('2000-01-01T00:00:00.000Z'),
    })
    await database.db.insert(providerDispatches).values({
      scopeKey: '7'.repeat(64),
      workspaceId: workspace.id,
      attemptId: attempt.id,
      provider: 'safe-provider',
      funding: 'managed',
      status: 'released',
      leaseExpiresAt: new Date('2100-01-01T00:00:00.000Z'),
    })

    const { getAdminJob, listAdminJobs } = await import('./jobs-repository')
    const { getAdminOpsSnapshot } = await import('./ops-repository')
    const jobs = await listAdminJobs()
    const ops = await getAdminOpsSnapshot()

    expect(jobs.items).toContainEqual(
      expect.objectContaining({ taskId: 'DIRECT', failureCategory: 'capacity' }),
    )
    await expect(getAdminJob(attempt.id)).resolves.toEqual([
      expect.objectContaining({ attemptId: attempt.id, failureCategory: 'capacity' }),
    ])
    expect(JSON.stringify(jobs)).not.toContain('secret provider response')
    expect(ops.queue).toEqual([{ status: 'queued', count: 1 }])
    expect(ops.workflowLeases).toContainEqual({ status: 'waiting', count: 1 })
    expect(ops.workflowLeases).not.toContainEqual(expect.objectContaining({ status: 'released' }))
    expect(ops.workflowLeases).not.toContainEqual(expect.objectContaining({ status: 'active' }))
    expect(ops.providerTickets).toContainEqual({ status: 'scheduled', count: 1 })
    expect(ops.providerTickets).not.toContainEqual(expect.objectContaining({ status: 'released' }))
    expect(ops.providerPools[0]).toMatchObject({ provider: 'safe-provider', currentConcurrency: 2 })
    expect(JSON.stringify(ops)).not.toContain('4444444444')
  })
})
