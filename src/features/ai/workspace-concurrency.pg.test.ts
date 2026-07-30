import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  projects,
  users,
  workflowConcurrencyLeases,
  workspaceEntitlements,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase
const WORKSPACE_ID = '41000000-0000-4000-8000-000000000001'
const USER_ID = '41000000-0000-4000-8000-000000000002'
const USER_B_ID = '41000000-0000-4000-8000-000000000005'
const PROJECT_A = '41000000-0000-4000-8000-000000000003'
const PROJECT_B = '41000000-0000-4000-8000-000000000004'
const START = new Date('2026-07-30T00:00:00.000Z')

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: `concurrency-${randomUUID()}`,
    name: 'Concurrency Test',
  })
  await database.db.insert(users).values([
    {
      id: USER_ID,
      email: `concurrency-${randomUUID()}@example.com`,
      name: 'Concurrency User',
      passwordHash: 'not-used',
    },
    {
      id: USER_B_ID,
      email: `concurrency-b-${randomUUID()}@example.com`,
      name: 'Concurrency User B',
      passwordHash: 'not-used',
    },
  ])
  await database.db.insert(projects).values([
    project(PROJECT_A),
    project(PROJECT_B),
  ])
  await database.db.insert(workspaceEntitlements).values({
    workspaceId: WORKSPACE_ID,
    planKey: 'free',
    startsAt: new Date(START.getTime() - 60_000),
    expiresAt: new Date(START.getTime() + 86_400_000),
  })
})
afterAll(async () => database.close())
afterEach(() => vi.unstubAllEnvs())

describe('workspace shot concurrency', () => {
  it('shares the Free limit across projects and activates at most three shots', async () => {
    const { tryAcquireWorkflowSlot } = await import('./workspace-concurrency')
    const results = []
    for (let index = 0; index < 5; index += 1) {
      results.push(await tryAcquireWorkflowSlot({
        workspaceId: WORKSPACE_ID,
        actorUserId: USER_ID,
        projectId: index % 2 === 0 ? PROJECT_A : PROJECT_B,
        workUnitKey: `shot-${index}`,
        now: new Date(START.getTime() + index * 500),
        database: database.db,
      }))
    }
    expect(results.filter((result) => result.status === 'active')).toHaveLength(3)
    expect(results.filter((result) => result.status === 'waiting')).toHaveLength(2)
    expect(results.at(-1)).toMatchObject({ limit: 3, active: 3, waiting: 2 })
  })

  it('reports the plan wait without blocking during account shadow rollout', async () => {
    vi.stubEnv('AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT', '0')
    const { tryAcquireWorkflowSlot } = await import('./workspace-concurrency')
    const results = []
    for (let index = 0; index < 4; index += 1) {
      results.push(await tryAcquireWorkflowSlot({
        workspaceId: WORKSPACE_ID,
        actorUserId: USER_ID,
        projectId: PROJECT_A,
        workUnitKey: `shadow-shot-${index}`,
        now: new Date(START.getTime() + index * 500),
        database: database.db,
      }))
    }
    expect(results.at(-1)).toMatchObject({
      status: 'active',
      active: 4,
      limit: 3,
      shadowWaitReason: 'plan_limit',
    })
  })

  it('keeps one slot for all steps of the same shot', async () => {
    const { tryAcquireWorkflowSlot } = await import('./workspace-concurrency')
    const input = {
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      projectId: PROJECT_A,
      workUnitKey: 'shot-shared',
      now: START,
      database: database.db,
    }
    await expect(tryAcquireWorkflowSlot(input)).resolves.toMatchObject({
      status: 'active',
      active: 1,
    })
    await expect(tryAcquireWorkflowSlot({
      ...input,
      now: new Date(START.getTime() + 500),
    })).resolves.toMatchObject({
      status: 'active',
      active: 1,
    })
    expect(await database.db.select().from(workflowConcurrencyLeases)).toHaveLength(1)
  })

  it('isolates the same shot key across two projects', async () => {
    const { tryAcquireWorkflowSlot } = await import('./workspace-concurrency')
    const base = {
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      workUnitKey: 'S001',
      now: START,
      database: database.db,
    }
    await expect(tryAcquireWorkflowSlot({
      ...base,
      projectId: PROJECT_A,
    })).resolves.toMatchObject({ status: 'active' })
    await expect(tryAcquireWorkflowSlot({
      ...base,
      projectId: PROJECT_B,
      now: new Date(START.getTime() + 500),
    })).resolves.toMatchObject({ status: 'active' })

    const leases = await database.db.select().from(workflowConcurrencyLeases)
    expect(leases).toHaveLength(2)
    expect(new Set(leases.map((lease) => lease.projectId))).toEqual(
      new Set([PROJECT_A, PROJECT_B]),
    )
  })

  it('releases a terminal shot and admits the oldest waiting shot after the stagger', async () => {
    const { tryAcquireWorkflowSlot } = await import('./workspace-concurrency')
    const { releaseWorkflowSlot } = await import('./workspace-concurrency-release')
    for (let index = 0; index < 4; index += 1) {
      await tryAcquireWorkflowSlot({
        workspaceId: WORKSPACE_ID,
        actorUserId: USER_ID,
        projectId: PROJECT_A,
        workUnitKey: `shot-${index}`,
        now: new Date(START.getTime() + index * 500),
        database: database.db,
      })
    }
    await releaseWorkflowSlot({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_A,
      workUnitKey: 'shot-0',
      outcome: 'released',
      now: new Date(START.getTime() + 2_000),
      database: database.db,
    })
    await expect(tryAcquireWorkflowSlot({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      projectId: PROJECT_A,
      workUnitKey: 'shot-3',
      now: new Date(START.getTime() + 2_500),
      database: database.db,
    })).resolves.toMatchObject({
      status: 'active',
      active: 3,
      waiting: 0,
    })
    const [released] = await database.db.select()
      .from(workflowConcurrencyLeases)
      .where(eq(workflowConcurrencyLeases.workUnitKey, 'shot-0'))
    expect(released.status).toBe('released')
  })

  it('projects account-safe counts using the database clock', async () => {
    const { getWorkspaceConcurrencyProjection } =
      await import('./workspace-concurrency-projection')
    const { tryAcquireWorkflowSlot } = await import('./workspace-concurrency')
    const now = new Date()
    await database.db
      .update(workspaceEntitlements)
      .set({
        planKey: 'pro',
        startsAt: new Date(now.getTime() - 60_000),
        expiresAt: new Date(now.getTime() + 86_400_000),
      })
      .where(eq(workspaceEntitlements.workspaceId, WORKSPACE_ID))
    await tryAcquireWorkflowSlot({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      projectId: PROJECT_A,
      workUnitKey: 'projection-shot',
      now,
      database: database.db,
    })

    await expect(getWorkspaceConcurrencyProjection({
      workspaceId: WORKSPACE_ID,
      database: database.db,
    })).resolves.toEqual({
      planKey: 'pro',
      limit: 20,
      active: 1,
      waiting: 0,
    })
  })

  it('admits 50 staggered Max shots across two users and projects with p95 under 20ms', async () => {
    const {
      registerWorkflowSlotsInTransaction,
      tryAcquireWorkflowSlot,
    } = await import('./workspace-concurrency')
    await database.db
      .update(workspaceEntitlements)
      .set({ planKey: 'max' })
      .where(eq(workspaceEntitlements.workspaceId, WORKSPACE_ID))
    const workUnitKeys = Array.from(
      { length: 50 },
      (_, index) => `max-shot-${String(index).padStart(2, '0')}`,
    )
    await database.db.transaction(async (transaction) => {
      await registerWorkflowSlotsInTransaction(transaction, {
        workspaceId: WORKSPACE_ID,
        actorUserId: USER_ID,
        projectId: PROJECT_A,
        workUnitKeys: workUnitKeys.filter((_, index) => index % 2 === 0),
        now: START,
      })
      await registerWorkflowSlotsInTransaction(transaction, {
        workspaceId: WORKSPACE_ID,
        actorUserId: USER_B_ID,
        projectId: PROJECT_B,
        workUnitKeys: workUnitKeys.filter((_, index) => index % 2 === 1),
        now: START,
      })
    })
    const durations: number[] = []
    const results = []
    for (let index = 0; index < 50; index += 1) {
      const startedAt = performance.now()
      results.push(await tryAcquireWorkflowSlot({
        workspaceId: WORKSPACE_ID,
        actorUserId: index % 2 === 0 ? USER_ID : USER_B_ID,
        projectId: index % 2 === 0 ? PROJECT_A : PROJECT_B,
        workUnitKey: workUnitKeys[index]!,
        now: new Date(START.getTime() + index * 500),
        database: database.db,
      }))
      durations.push(performance.now() - startedAt)
    }
    const sorted = [...durations].sort((left, right) => left - right)
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!
    expect(results.map((result) => result.status)).toEqual(
      Array.from({ length: 50 }, () => 'active'),
    )
    expect(results.at(-1)).toMatchObject({
      limit: 50,
      active: 50,
      waiting: 0,
    })
    expect(p95).toBeLessThan(20)
  })
})

function project(id: string): typeof projects.$inferInsert {
  return {
    workspaceId: WORKSPACE_ID,
    id,
    title: id,
    script: '',
    workflowVersion: 'concurrency-test-v1',
    exportSettings: { schemaVersion: 1 },
  }
}
