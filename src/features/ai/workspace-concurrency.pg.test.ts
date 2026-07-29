import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
  await database.db.insert(users).values({
    id: USER_ID,
    email: `concurrency-${randomUUID()}@example.com`,
    name: 'Concurrency User',
    passwordHash: 'not-used',
  })
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

  it('releases a terminal shot and admits the oldest waiting shot after the stagger', async () => {
    const {
      releaseWorkflowSlot,
      tryAcquireWorkflowSlot,
    } = await import('./workspace-concurrency')
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
