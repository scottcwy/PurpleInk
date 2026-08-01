import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiAccessCounters, users } from '@/lib/db/schema'
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

async function seedUser(email: string): Promise<string> {
  const [row] = await database.db
    .insert(users)
    .values({ email, name: email, passwordHash: 'test-only-password-hash' })
    .returning({ id: users.id })
  if (!row) throw new Error('user seed failed')
  return row.id
}

describe('global administrator roles', () => {
  it('keeps ordinary and seed-style owners on the default user role', async () => {
    const id = await seedUser('owner@example.com')
    const [row] = await database.db.select().from(users).where(eq(users.id, id))

    expect(row?.role).toBe('user')
  })

  it('serializes changes and refuses to revoke the last active administrator', async () => {
    await seedUser('first@example.com')
    await seedUser('second@example.com')
    const { setUserRoleByEmail } = await import('./admin-role-repository')

    await expect(
      setUserRoleByEmail({ email: 'first@example.com', role: 'admin' }),
    ).resolves.toMatchObject({ outcome: 'updated', previousRole: 'user', role: 'admin' })
    await expect(
      setUserRoleByEmail({ email: 'first@example.com', role: 'user' }),
    ).resolves.toEqual({ outcome: 'last_active_admin' })

    await setUserRoleByEmail({ email: 'second@example.com', role: 'admin' })
    await expect(
      setUserRoleByEmail({ email: 'first@example.com', role: 'user' }),
    ).resolves.toMatchObject({ outcome: 'updated', previousRole: 'admin', role: 'user' })
  })
})

describe('API access counters', () => {
  it('increments one PostgreSQL minute bucket without storing request identity', async () => {
    const { recordApiAccess } = await import('@/features/auth/api-access-counter')

    await recordApiAccess('projects', 201)
    await recordApiAccess('projects', 204)
    await recordApiAccess('projects', 404)

    const rows = await database.db.select().from(apiAccessCounters)
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ routeGroup: 'projects', outcome: '2xx', count: 2 }),
      expect.objectContaining({ routeGroup: 'projects', outcome: '404', count: 1 }),
    ]))
  })
})
