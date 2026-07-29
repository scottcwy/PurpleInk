import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  providerDispatches,
  providerPoolStates,
  pipelineRuns,
  projects,
  taskAttempts,
  users,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: LOCAL_WORKSPACE_ID,
    slug: `dispatch-${randomUUID()}`,
    name: 'Provider dispatch test',
  })
})

afterAll(async () => {
  await database.close()
})

describe('provider dispatch Postgres arbitration', () => {
  it('paces StepFun globally at 400-440ms without treating RPM as concurrency', async () => {
    const { reserveProviderDispatch } = await import('./provider-dispatch')
    await runInAuthContext(
      { workspaceId: LOCAL_WORKSPACE_ID, userId: 'test-user' },
      async () => {
        const first = await reserveProviderDispatch({
          providerId: 'stepfun',
          providerLabel: '阶跃星辰',
          funding: 'managed',
          apiKey: 'managed-key-a',
          database: database.db,
        })
        await first.release()
        let waitError: unknown
        try {
          await reserveProviderDispatch({
            providerId: 'stepfun',
            providerLabel: '阶跃星辰',
            funding: 'managed',
            apiKey: 'managed-key-b',
            database: database.db,
          })
        } catch (error) {
          waitError = error
        }
        expect(waitError).toMatchObject({
          name: 'ProviderDispatchWaitError',
          kind: 'rate_limit',
          waitReason: 'pacing',
        })
        const [latest] = await database.db.select().from(providerDispatches)
          .orderBy(asc(providerDispatches.reservedAt))
        const retryAt = Date.parse(
          (waitError as { retryAt: string }).retryAt,
        )
        expect(retryAt - latest.reservedAt.getTime()).toBeGreaterThanOrEqual(400)
        expect(retryAt - latest.reservedAt.getTime()).toBeLessThanOrEqual(440)
      },
    )
  })

  it('atomically admits at most 5 requests in a rolling minute', async () => {
    const { reserveProviderDispatch } = await import('./provider-dispatch')
    const settled = await runInAuthContext(
      { workspaceId: LOCAL_WORKSPACE_ID, userId: 'test-user' },
      () => Promise.allSettled(Array.from({ length: 7 }, () =>
        reserveProviderDispatch({
          providerId: 'stepfun',
          providerLabel: '阶跃星辰',
          funding: 'managed',
          apiKey: 'shared-managed-key',
          limits: { concurrency: 99, rpm: 5 },
          database: database.db,
        })
      ))
    )
    const admitted = settled.filter((result) => result.status === 'fulfilled')
    const deferred = settled.filter((result) => result.status === 'rejected')
    expect(admitted).toHaveLength(5)
    expect(deferred).toHaveLength(2)
    for (const result of deferred) {
      if (result.status !== 'rejected') continue
      expect(result.reason).toMatchObject({
        name: 'ProviderDispatchWaitError',
        kind: 'rate_limit',
        httpStatus: 429,
      })
    }
    await Promise.all(admitted.map((result) =>
      result.status === 'fulfilled' ? result.value.release() : Promise.resolve()
    ))
    const rows = await database.db
      .select()
      .from(providerDispatches)
      .where(eq(providerDispatches.provider, 'stepfun'))
      .orderBy(asc(providerDispatches.reservedAt))
    expect(rows).toHaveLength(5)
    expect(rows.every((row) => row.status === 'released')).toBe(true)
    expect(rows.every((row) =>
      row.leaseExpiresAt.getTime() > row.reservedAt.getTime()
      && row.releasedAt !== null
      && row.releasedAt.getTime() >= row.reservedAt.getTime()
    )).toBe(true)
    expect(
      rows.at(-1)!.reservedAt.getTime() - rows[0]!.reservedAt.getTime()
    ).toBeLessThan(60_000)
  })

  it('shares a learned 429 cooldown before another process goes outbound', async () => {
    const { reserveProviderDispatch } = await import('./provider-dispatch')
    await runInAuthContext(
      { workspaceId: LOCAL_WORKSPACE_ID, userId: 'test-user' },
      async () => {
        const first = await reserveProviderDispatch({
          providerId: 'stepfun',
          providerLabel: '阶跃星辰',
          funding: 'managed',
          apiKey: 'shared-managed-key',
          limits: { concurrency: 99, rpm: 99 },
          database: database.db,
        })
        const retryAt = new Date(Date.now() + 30_000)
        await first.defer(retryAt)
        await first.release()
        await expect(reserveProviderDispatch({
          providerId: 'stepfun',
          providerLabel: '阶跃星辰',
          funding: 'managed',
          apiKey: 'shared-managed-key',
          limits: { concurrency: 99, rpm: 99 },
          database: database.db,
        })).rejects.toMatchObject({
          name: 'ProviderDispatchWaitError',
          kind: 'rate_limit',
          retryAt: retryAt.toISOString(),
        })
      }
    )
  })

  it('reduces managed in-flight capacity by 25 percent after a real 429', async () => {
    const { reserveProviderDispatch } = await import('./provider-dispatch')
    await runInAuthContext(
      { workspaceId: LOCAL_WORKSPACE_ID, userId: 'test-user' },
      async () => {
        const lease = await reserveProviderDispatch({
          providerId: 'mimo',
          providerLabel: '小米 MiMo',
          funding: 'managed',
          apiKey: 'managed-key',
          database: database.db,
        })
        await lease.defer(new Date(Date.now() + 10_000))
        await lease.release()
      },
    )
    const [state] = await database.db.select().from(providerPoolStates)
    expect(state).toMatchObject({
      provider: 'mimo',
      currentConcurrency: 6,
      completedSinceAdjustment: 0,
      failureCount: 1,
    })
  })

  it('yields a repeated actor when another user is already waiting for the pool', async () => {
    const { providerScopeKey, reserveProviderDispatch } = await import('./provider-dispatch')
    const actorA = randomUUID()
    const actorB = randomUUID()
    const projectId = randomUUID()
    const runId = randomUUID()
    const scopeKey = providerScopeKey({
      providerId: 'gemini',
      funding: 'managed',
      workspaceId: LOCAL_WORKSPACE_ID,
      apiKey: 'managed-key',
    })
    await database.db.insert(users).values([
      {
        id: actorA,
        email: `${actorA}@example.test`,
        name: 'Actor A',
        passwordHash: 'test',
      },
      {
        id: actorB,
        email: `${actorB}@example.test`,
        name: 'Actor B',
        passwordHash: 'test',
      },
    ])
    await database.db.insert(projects).values({
      workspaceId: LOCAL_WORKSPACE_ID,
      id: projectId,
      title: '公平调度',
      script: '',
      workflowVersion: 'test',
      exportSettings: { schemaVersion: 1, settings: {} },
    })
    await database.db.insert(pipelineRuns).values({
      workspaceId: LOCAL_WORKSPACE_ID,
      id: runId,
      projectId,
      requestedByUserId: actorB,
      status: 'queued',
      workflowVersion: 'test',
      fingerprint: 'f'.repeat(64),
    })
    await database.db.insert(taskAttempts).values({
      workspaceId: LOCAL_WORKSPACE_ID,
      runId,
      taskId: 'legacy.director-stage',
      entityType: 'node',
      entityId: randomUUID(),
      attemptNo: 1,
      status: 'queued',
      fingerprint: 'f'.repeat(64),
      checkpoint: {
        schemaVersion: 1,
        queueMeta: { providerScopeKey: scopeKey },
      },
    })

    await runInAuthContext(
      { workspaceId: LOCAL_WORKSPACE_ID, userId: actorA },
      async () => {
        const first = await reserveProviderDispatch({
          providerId: 'gemini',
          providerLabel: 'Gemini',
          funding: 'managed',
          apiKey: 'managed-key',
          database: database.db,
        })
        await first.release()
        await expect(reserveProviderDispatch({
          providerId: 'gemini',
          providerLabel: 'Gemini',
          funding: 'managed',
          apiKey: 'managed-key',
          database: database.db,
        })).rejects.toMatchObject({
          name: 'ProviderDispatchWaitError',
          waitReason: 'fairness',
        })
      },
    )
  })
})
