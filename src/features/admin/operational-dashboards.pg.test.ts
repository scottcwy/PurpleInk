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
      code: 'PROVIDER_POOL_WAIT',
      message: 'secret provider response and user@example.com',
    },
  }).returning({ id: taskAttempts.id })
  if (!attempt) throw new Error('seed attempt failed')
  return { user, workspace, project, run, attempt }
}

describe('admin operational PostgreSQL projections', () => {
  it('reports last-session activity as a mutable snapshot, not historical DAU', async () => {
    const { user, workspace } = await seedWorkflow()
    const [session] = await database.db.insert(sessions).values({
      tokenHash: '2'.repeat(64),
      userId: user.id,
      workspaceId: workspace.id,
      expiresAt: new Date('2100-01-01T00:00:00.000Z'),
    }).returning({ id: sessions.id })
    if (!session) throw new Error('seed session failed')
    await database.sql`
      update sessions
      set last_seen_at = date_trunc('day', now()) - interval '1 day' + interval '12 hours'
      where id = ${session.id}
    `
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
    const { getAdminLastSessionActivityMetrics } = await import('./metrics-repository')
    const { getAdminSecuritySnapshot } = await import('./security-repository')
    const overview = await getAdminOverview()
    const beforeMove = await getAdminLastSessionActivityMetrics(7)
    const previousActivity = beforeMove.days.find(
      (day) => day.usersWithLastSessionActivity === 1,
    )
    expect(previousActivity).toBeDefined()
    expect(beforeMove).toMatchObject({
      metric: 'last_session_activity',
      snapshotNature: 'mutable',
      historicalDau: false,
      totalUsers: 1,
      usersWithLastSessionActivityToday: 0,
      usersWithLastSessionActivity7d: 1,
      usersWithLastSessionActivity30d: 1,
    })

    await database.sql`update sessions set last_seen_at = now() where id = ${session.id}`
    const afterMove = await getAdminLastSessionActivityMetrics(7)
    const security = await getAdminSecuritySnapshot()

    expect(overview).toMatchObject({ users: { total: 1, active: 1, disabled: 0 }, activeSessions: 1 })
    expect(afterMove.days.find((day) => day.date === previousActivity?.date))
      .toMatchObject({ usersWithLastSessionActivity: 0 })
    expect(afterMove).toMatchObject({
      metric: 'last_session_activity',
      snapshotNature: 'mutable',
      historicalDau: false,
      usersWithLastSessionActivityToday: 1,
    })
    expect(security.apiAccess).toEqual([{ routeGroup: 'projects', outcome: '2xx', count: 4 }])
    expect(security.authThrottle).toEqual({ trackedBuckets: 1, attempts: 2 })
    expect(JSON.stringify(security)).not.toContain('ip:')
  })

  it('projects real attempts safely and observes current lease/dispatch state', async () => {
    const { workspace, project, run, attempt } = await seedWorkflow()
    const [runWithoutAttempt] = await database.db.insert(pipelineRuns).values({
      workspaceId: workspace.id,
      projectId: project.id,
      status: 'triggering',
      workflowVersion: 'v3',
      fingerprint: '9'.repeat(64),
    }).returning({ id: pipelineRuns.id })
    if (!runWithoutAttempt) throw new Error('seed run without attempt failed')
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
    expect(jobs.items).not.toContainEqual(
      expect.objectContaining({ runId: runWithoutAttempt.id }),
    )
    await expect(getAdminJob(runWithoutAttempt.id)).resolves.toEqual([
      expect.objectContaining({ runId: runWithoutAttempt.id, attemptId: null }),
    ])
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

  it('uses the global created-at index for default jobs top-N without an explicit sort', async () => {
    await seedWorkflow()
    await database.sql`set enable_seqscan = off`
    try {
      const [explain] = await database.sql<{ 'QUERY PLAN': unknown }[]>`
        explain (format json)
        select attempt.id
        from task_attempts as attempt
        inner join pipeline_runs as run
          on run.workspace_id = attempt.workspace_id
          and run.id = attempt.run_id
        order by attempt.created_at desc nulls last
        limit 50
      `
      const plan = JSON.stringify(explain?.['QUERY PLAN'])
      // Stable structural contract: disabling seqscan forces the planner to prove the top-N path.
      expect(plan).toContain('task_attempts_admin_created_idx')
      expect(plan).not.toContain('"Node Type":"Sort"')
    } finally {
      await database.sql`set enable_seqscan = on`
    }
  })
})
