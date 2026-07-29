import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { providerDispatches, workspaces } from '@/lib/db/schema'
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
        name: 'ProviderRequestError',
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
          name: 'ProviderRequestError',
          kind: 'rate_limit',
          retryAt: retryAt.toISOString(),
        })
      }
    )
  })
})
