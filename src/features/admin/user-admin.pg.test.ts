import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sessions,
  users,
  workspaceEntitlements,
  workspaceMembers,
} from '@/lib/db/schema/index'
import { createPgTestDatabase, type PgTestDatabase } from '@/lib/db/test/pg-test-database'

const getDbMock = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})
// authenticate 走 account-service，邮件通道按未配置处理。
vi.mock('@/features/auth/mailer', () => ({
  sendVerificationCodeEmail: vi.fn(),
  readMailConfig: () => null,
  isMailChannelConfigured: () => false,
}))

const database = {} as PgTestDatabase
const PASSWORD = 'purple ink 2026'

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))

beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
})

afterAll(async () => database.close())

async function createUser(email: string, role: 'user' | 'admin' = 'user') {
  const { createAdminUser } = await import('./user-admin')
  const result = await createAdminUser({ email, name: '被管理用户', password: PASSWORD, role })
  if (!result.ok) throw new Error(`createAdminUser failed: ${result.code}`)
  return result.userId
}

/** 给用户插一条未过期会话，用于断言「禁用/改密即踢下线」。 */
async function seedSession(userId: string): Promise<void> {
  const [membership] = await database.db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
  if (!membership) throw new Error('membership missing')
  await database.db.insert(sessions).values({
    tokenHash: 'a'.repeat(64),
    userId,
    workspaceId: membership.workspaceId,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  })
}

describe('createAdminUser', () => {
  it('creates user + workspace owner + free entitlement with the requested role', async () => {
    const userId = await createUser('admin@example.com', 'admin')

    const [user] = await database.db.select().from(users)
    const [membership] = await database.db.select().from(workspaceMembers)
    const [entitlement] = await database.db.select().from(workspaceEntitlements)
    expect(user).toMatchObject({ id: userId, email: 'admin@example.com', role: 'admin' })
    expect(user?.emailVerifiedAt).not.toBeNull()
    expect(user?.passwordHash).not.toContain(PASSWORD)
    expect(membership).toMatchObject({ userId, role: 'owner' })
    expect(entitlement?.planKey).toBe('free')
  })

  it('rejects duplicate email case-insensitively', async () => {
    await createUser('dup@example.com')
    const { createAdminUser } = await import('./user-admin')

    const result = await createAdminUser({
      email: 'DUP@example.com',
      name: '重复',
      password: PASSWORD,
      role: 'user',
    })

    expect(result).toEqual({ ok: false, code: 'email-taken' })
  })
})

describe('updateAdminUser', () => {
  it('disabling a user revokes all sessions and blocks login', async () => {
    const userId = await createUser('victim@example.com')
    await seedSession(userId)
    const actor = await createUser('boss@example.com', 'admin')
    const { updateAdminUser } = await import('./user-admin')

    const result = await updateAdminUser({
      userId,
      actorUserId: actor,
      patch: { status: 'disabled' },
    })

    expect(result.ok).toBe(true)
    const [user] = await database.db.select().from(users).where(eq(users.id, userId))
    expect(user?.status).toBe('disabled')
    const remaining = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
    expect(remaining).toHaveLength(0)

    // 禁用后登录必须被拒，且与「口令错误」同一类别文案（不泄露禁用状态）。
    const { authenticate } = await import('@/features/auth/account-service')
    const login = await authenticate({
      email: 'victim@example.com',
      password: PASSWORD,
      fingerprint: { ip: '203.0.113.9', userAgent: 'vitest' },
    })
    expect(login.ok).toBe(false)
    if (!login.ok) expect(login.code).toBe('invalid-credentials')
  })

  it('resetting the password rotates the hash and revokes sessions', async () => {
    const userId = await createUser('rotate@example.com')
    await seedSession(userId)
    const actor = await createUser('boss@example.com', 'admin')
    const [before] = await database.db.select().from(users).where(eq(users.id, userId))
    const { updateAdminUser } = await import('./user-admin')

    const result = await updateAdminUser({
      userId,
      actorUserId: actor,
      patch: { password: 'new pass 2026' },
    })

    expect(result.ok).toBe(true)
    const [after] = await database.db.select().from(users).where(eq(users.id, userId))
    expect(after?.passwordHash).not.toBe(before?.passwordHash)
    expect(after && before && after.passwordUpdatedAt > before.passwordUpdatedAt).toBe(true)
    const remaining = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
    expect(remaining).toHaveLength(0)
  })

  it('refuses self-disable and self-demote', async () => {
    const admin = await createUser('self@example.com', 'admin')
    const { updateAdminUser } = await import('./user-admin')

    for (const patch of [{ status: 'disabled' as const }, { role: 'user' as const }]) {
      const result = await updateAdminUser({ userId: admin, actorUserId: admin, patch })
      expect(result).toEqual({ ok: false, code: 'self-forbidden' })
    }
  })

  it('returns not-found for unknown user', async () => {
    const actor = await createUser('boss@example.com', 'admin')
    const { updateAdminUser } = await import('./user-admin')

    const result = await updateAdminUser({
      userId: '99999999-9999-4999-8999-999999999999',
      actorUserId: actor,
      patch: { name: '无人' },
    })

    expect(result).toEqual({ ok: false, code: 'not-found' })
  })
})

describe('deleteAdminUser', () => {
  it('hard-deletes the user and cascades sessions and memberships', async () => {
    const userId = await createUser('gone@example.com')
    await seedSession(userId)
    const actor = await createUser('boss@example.com', 'admin')
    const { deleteAdminUser } = await import('./user-admin')

    const result = await deleteAdminUser({ userId, actorUserId: actor })

    expect(result.ok).toBe(true)
    expect(await database.db.select().from(users).where(eq(users.id, userId))).toHaveLength(0)
    expect(
      await database.db.select().from(sessions).where(eq(sessions.userId, userId)),
    ).toHaveLength(0)
    expect(
      await database.db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, userId)),
    ).toHaveLength(0)
  })

  it('refuses self-delete', async () => {
    const admin = await createUser('self@example.com', 'admin')
    const { deleteAdminUser } = await import('./user-admin')

    const result = await deleteAdminUser({ userId: admin, actorUserId: admin })

    expect(result).toEqual({ ok: false, code: 'self-forbidden' })
  })
})

describe('listAdminUsers', () => {
  it('searches by email fragment and reports last seen from sessions', async () => {
    const userId = await createUser('findme@example.com')
    await seedSession(userId)
    await createUser('other@example.com')
    const { listAdminUsers } = await import('./user-admin')

    const result = await listAdminUsers({ search: 'findme', page: 1, pageSize: 10 })

    expect(result.total).toBe(1)
    expect(result.users[0]).toMatchObject({ email: 'findme@example.com' })
    expect(result.users[0]?.lastSeenAt).not.toBeNull()
  })
})
