import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import {
  redemptionBatches,
  redemptionCodes,
  sessions,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import { createPgTestDatabase, type PgTestDatabase } from '@/lib/db/test/pg-test-database'

const getDbMock = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})

const database = {} as PgTestDatabase
const ACTOR_ID = '71000000-0000-4000-8000-000000000001'
const SECOND_ADMIN_ID = '71000000-0000-4000-8000-000000000002'

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
  process.env.CVC_REDEMPTION_CODE_PEPPER = 'admin-account-billing-test-pepper'
  await database.db.insert(users).values([
    {
      id: ACTOR_ID,
      email: 'actor@example.test',
      name: 'Actor',
      passwordHash: 'test-only',
      role: 'admin',
    },
    {
      id: SECOND_ADMIN_ID,
      email: 'second@example.test',
      name: 'Second',
      passwordHash: 'test-only',
      role: 'admin',
    },
  ])
})
afterAll(async () => database.close())

describe('safe account administration', () => {
  it('treats ILIKE wildcard characters as literal search text', async () => {
    await database.db.insert(users).values({
      email: 'literal%_@example.test',
      name: 'Literal wildcard',
      passwordHash: 'test-only',
    })
    const { listAdminUsers } = await import('./user-admin')
    const result = await listAdminUsers({ q: '%_' })
    expect(result.items.map((item) => item.email)).toEqual(['literal%_@example.test'])
  })

  it('creates user, workspace, owner membership and Free entitlement atomically', async () => {
    const { createAdminUser } = await import('./user-admin')
    const created = await createAdminUser({
      email: 'created@example.test',
      name: 'Created User',
      password: 'A-valid-password-123!',
      workspaceName: 'Created Workspace',
    })

    const [user] = await database.db.select().from(users).where(eq(users.id, created.id))
    expect(user).toMatchObject({
      email: 'created@example.test',
      name: 'Created User',
      role: 'user',
      status: 'active',
    })
    expect(user?.passwordHash).not.toContain('A-valid-password-123!')
    const [membership] = await database.db.select().from(workspaceMembers)
      .where(eq(workspaceMembers.userId, created.id))
    expect(membership?.role).toBe('owner')
    expect(await database.db.select().from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, membership!.workspaceId)))
      .toHaveLength(1)
  })

  it('disables without deleting owned data, revokes sessions, then restores', async () => {
    const [workspace] = await database.db.insert(workspaces).values({
      slug: 'second-admin',
      name: 'Second Admin',
    }).returning()
    await database.db.insert(workspaceMembers).values({
      workspaceId: workspace!.id,
      userId: SECOND_ADMIN_ID,
      role: 'owner',
    })
    await database.db.insert(sessions).values({
      tokenHash: 'a'.repeat(64),
      userId: SECOND_ADMIN_ID,
      workspaceId: workspace!.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const { updateAdminUser } = await import('./user-admin')

    await updateAdminUser({
      actorUserId: ACTOR_ID,
      targetUserId: SECOND_ADMIN_ID,
      patch: { status: 'disabled' },
    })
    expect((await database.db.select().from(users)
      .where(eq(users.id, SECOND_ADMIN_ID)))[0]?.status).toBe('disabled')
    expect(await database.db.select().from(sessions)
      .where(eq(sessions.userId, SECOND_ADMIN_ID))).toEqual([])
    expect(await database.db.select().from(workspaces)
      .where(eq(workspaces.id, workspace!.id))).toHaveLength(1)

    await updateAdminUser({
      actorUserId: ACTOR_ID,
      targetUserId: SECOND_ADMIN_ID,
      patch: { status: 'active' },
    })
    expect((await database.db.select().from(users)
      .where(eq(users.id, SECOND_ADMIN_ID)))[0]?.status).toBe('active')
  })

  it('refuses self-disable and serializes concurrent last-admin protection', async () => {
    const { updateAdminUser } = await import('./user-admin')
    await expect(updateAdminUser({
      actorUserId: ACTOR_ID,
      targetUserId: ACTOR_ID,
      patch: { status: 'disabled' },
    })).rejects.toMatchObject({ code: 'SELF_DISABLE' })

    const ordinaryActor = (await database.db.insert(users).values({
      email: 'operator@example.test',
      name: 'Operator',
      passwordHash: 'test-only',
    }).returning({ id: users.id }))[0]!
    const results = await Promise.allSettled([
      updateAdminUser({
        actorUserId: ordinaryActor.id,
        targetUserId: ACTOR_ID,
        patch: { status: 'disabled' },
      }),
      updateAdminUser({
        actorUserId: ordinaryActor.id,
        targetUserId: SECOND_ADMIN_ID,
        patch: { status: 'disabled' },
      }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await database.db.select().from(users).where(and(
      eq(users.role, 'admin'),
      eq(users.status, 'active'),
    ))).toHaveLength(1)
  })

  it('serializes disable and CLI role demotion through one global admin lock', async () => {
    const [operator] = await database.db.insert(users).values({
      email: 'cross-entry-operator@example.test',
      name: 'Cross-entry operator',
      passwordHash: 'test-only',
    }).returning({ id: users.id })
    const [{ updateAdminUser }, { setUserRoleByEmail }] = await Promise.all([
      import('./user-admin'),
      import('./admin-role-repository'),
    ])
    await database.sql`
      create function delay_cross_entry_admin_mutation() returns trigger as $$
      begin
        perform pg_sleep(0.25);
        return new;
      end;
      $$ language plpgsql
    `
    await database.sql`
      create trigger delay_cross_entry_admin_mutation_trigger
      before update of role, status on users
      for each row execute function delay_cross_entry_admin_mutation()
    `
    const concurrentClient = postgres(process.env.TEST_DATABASE_URL!, { max: 2 })
    const concurrentDb = drizzle(concurrentClient, { schema })
    getDbMock.mockResolvedValue(concurrentDb)

    const [disable, demote] = await Promise.all([
      updateAdminUser({
        actorUserId: operator!.id,
        targetUserId: ACTOR_ID,
        patch: { status: 'disabled' },
      }).then(() => 'updated' as const).catch((error: unknown) => (
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'unknown'
      )),
      setUserRoleByEmail({
        email: 'second@example.test',
        role: 'user',
      }).then((result) => result.outcome),
    ]).finally(async () => {
      await concurrentClient.end({ timeout: 5 })
      getDbMock.mockResolvedValue(database.db)
    })

    expect([disable, demote]).toContain('updated')
    expect([disable, demote]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^(LAST_ACTIVE_ADMIN|last_active_admin)$/),
    ]))
    expect(await database.db.select().from(users).where(and(
      eq(users.role, 'admin'),
      eq(users.status, 'active'),
    ))).toHaveLength(1)
  })
})

describe('safe billing administration', () => {
  it('returns plaintext codes once while persisting hashes only, then revokes the batch', async () => {
    const { createRedemptionBatch, revokeRedemptionBatch } = await import('./billing-admin')
    const created = await createRedemptionBatch({
      actorUserId: ACTOR_ID,
      planKey: 'plus',
      label: 'Launch batch',
      count: 2,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    expect(created.codes).toHaveLength(2)
    const stored = await database.db.select().from(redemptionCodes)
    expect(stored).toHaveLength(2)
    expect(JSON.stringify(stored)).not.toContain(created.codes[0])

    const listed = await (await import('./billing-admin')).getAdminBilling({ page: 1, pageSize: 10 })
    expect(listed.batches[0]).toMatchObject({
      id: created.batchId,
      totalCodes: 2,
      consumedCodes: 0,
      revokedAt: null,
    })
    expect(JSON.stringify(listed)).not.toContain(created.codes[0])
    expect(listed.ledgers).toEqual({
      officialCost: {
        totalCnyMicros: null,
        knownCnyMicros: '0',
        entryCount: 0,
        knownEntryCount: 0,
        measurementQualities: [],
      },
      entitlement: {
        totalDebitCnyMicros: null,
        knownDebitCnyMicros: '0',
        entryCount: 0,
      },
    })

    await revokeRedemptionBatch({ batchId: created.batchId })
    const [batch] = await database.db.select().from(redemptionBatches)
      .where(eq(redemptionBatches.id, created.batchId))
    expect(batch?.revokedAt).toBeInstanceOf(Date)

    const [consumer] = await database.db.insert(users).values({
      email: 'consumer@example.test',
      name: 'Consumer',
      passwordHash: 'test-only',
    }).returning({ id: users.id })
    const [workspace] = await database.db.insert(workspaces).values({
      slug: 'consumer',
      name: 'Consumer',
    }).returning({ id: workspaces.id })
    await database.db.insert(workspaceMembers).values({
      workspaceId: workspace!.id,
      userId: consumer!.id,
      role: 'owner',
    })
    const { provisionFreeEntitlement, redeemBillingCode } = await import('@/features/billing')
    await database.db.transaction((tx) => provisionFreeEntitlement(tx, workspace!.id, new Date()))
    const redemption = await runInAuthContext(
      { userId: consumer!.id, workspaceId: workspace!.id },
      () => redeemBillingCode({ code: created.codes[0]!, idempotencyKey: 'revoked-batch' }),
    )
    expect(redemption).toEqual({ ok: false, code: 'redemption_unavailable' })
  })
})
