import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessions, users, workspaceMembers, workspaces } from '@/lib/db/schema/index'
import { createPgTestDatabase, type PgTestDatabase } from '@/lib/db/test/pg-test-database'

const getDbMock = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})
// 邮件通道在集成测试里不外发；断言只关心「是否尝试发送」与业务状态。
const sendMock = vi.hoisted(() => vi.fn())
vi.mock('./mailer', () => ({
  sendVerificationCodeEmail: sendMock,
  readMailConfig: () => null,
  isMailChannelConfigured: () => false,
}))

const database = {} as PgTestDatabase
const MASTER_KEY = Buffer.alloc(32, 9).toString('base64')
const originalMasterKey = process.env.CVC_CREDENTIAL_MASTER_KEY
const FINGERPRINT = { ip: '203.0.113.7', userAgent: 'vitest' }
const PASSWORD = 'purple ink 2026'

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))

beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
  sendMock.mockReset()
  sendMock.mockResolvedValue({ ok: true })
  process.env.CVC_CREDENTIAL_MASTER_KEY = MASTER_KEY
})

afterAll(async () => {
  if (originalMasterKey === undefined) delete process.env.CVC_CREDENTIAL_MASTER_KEY
  else process.env.CVC_CREDENTIAL_MASTER_KEY = originalMasterKey
  await database.close()
})

/** 直接种一条有效验证码，绕过人机验证与限流（那些有独立单测）。 */
async function seedCode(email: string, purpose: 'signup' | 'password_reset') {
  const { hashVerificationCode, verificationCodeExpiresAt } = await import('./verification-code')
  const { authSigningKey } = await import('./signing-key')
  const code = '135790'
  await database.sql`
    INSERT INTO email_verification_codes (email, purpose, code_hash, expires_at)
    VALUES (
      ${email}, ${purpose},
      ${hashVerificationCode({ code, email, purpose, key: authSigningKey('verificationCode') })},
      ${verificationCodeExpiresAt(new Date()).toISOString()}
    )
  `
  return code
}

async function register(email: string) {
  const { registerAccount } = await import('./account-service')
  return registerAccount({
    email,
    name: '示例用户',
    workspaceName: '示例 Workspace',
    password: PASSWORD,
    code: await seedCode(email, 'signup'),
    fingerprint: FINGERPRINT,
  })
}

describe('registerAccount', () => {
  it('creates user, workspace and owner membership together', async () => {
    const result = await register('owner@example.com')

    expect(result.ok).toBe(true)
    const [user] = await database.db.select().from(users)
    const [workspace] = await database.db.select().from(workspaces)
    const [membership] = await database.db.select().from(workspaceMembers)
    expect(user?.email).toBe('owner@example.com')
    expect(user?.emailVerifiedAt).not.toBeNull()
    expect(membership).toMatchObject({
      userId: user?.id,
      workspaceId: workspace?.id,
      role: 'owner',
    })
  })

  it('issues a session bound to the freshly created workspace', async () => {
    const result = await register('owner@example.com')
    if (!result.ok) throw new Error('registration should succeed')

    const { resolveSession } = await import('./session')
    const owner = await resolveSession(result.session.token)
    const [workspace] = await database.db.select().from(workspaces)
    expect(owner?.workspaceId).toBe(workspace?.id)
    expect(owner?.email).toBe('owner@example.com')
  })

  it('never stores the password in clear text', async () => {
    await register('owner@example.com')

    const [user] = await database.db.select().from(users)
    expect(user?.passwordHash).not.toContain(PASSWORD)
    expect(user?.passwordHash.startsWith('scrypt$')).toBe(true)
  })

  it('rolls back everything when the verification code is wrong', async () => {
    const { registerAccount } = await import('./account-service')
    await seedCode('owner@example.com', 'signup')

    const result = await registerAccount({
      email: 'owner@example.com',
      name: '示例用户',
      workspaceName: '示例 Workspace',
      password: PASSWORD,
      code: '000000',
      fingerprint: FINGERPRINT,
    })

    expect(result).toMatchObject({ ok: false, code: 'code-invalid' })
    expect(await database.db.select().from(users)).toHaveLength(0)
    expect(await database.db.select().from(workspaces)).toHaveLength(0)
  })

  it('treats a code as one-shot: the same code cannot register twice', async () => {
    const { registerAccount } = await import('./account-service')
    const code = await seedCode('owner@example.com', 'signup')
    const base = {
      name: '示例用户',
      workspaceName: '示例 Workspace',
      password: PASSWORD,
      code,
      fingerprint: FINGERPRINT,
    }

    expect((await registerAccount({ ...base, email: 'owner@example.com' })).ok).toBe(true)
    expect(
      await registerAccount({ ...base, email: 'owner@example.com' }),
    ).toMatchObject({ ok: false })
    expect(await database.db.select().from(users)).toHaveLength(1)
  })

  it('rejects a second account on the same mailbox regardless of letter case', async () => {
    expect((await register('Owner@Example.com')).ok).toBe(true)
    const second = await register('owner@example.com')

    expect(second).toMatchObject({ ok: false })
    expect(await database.db.select().from(users)).toHaveLength(1)
  })
})

describe('authenticate', () => {
  it('accepts the right password and rejects the wrong one with the same shape', async () => {
    await register('owner@example.com')
    const { authenticate } = await import('./account-service')

    const good = await authenticate({
      email: 'owner@example.com',
      password: PASSWORD,
      fingerprint: FINGERPRINT,
    })
    const bad = await authenticate({
      email: 'owner@example.com',
      password: 'wrong password 1',
      fingerprint: FINGERPRINT,
    })
    const missing = await authenticate({
      email: 'nobody@example.com',
      password: PASSWORD,
      fingerprint: FINGERPRINT,
    })

    expect(good.ok).toBe(true)
    // 「账号不存在」与「口令错误」必须不可区分（PLAN-002 §3.4）。
    expect(bad).toEqual(missing)
  })

  it('matches the mailbox case-insensitively', async () => {
    await register('owner@example.com')
    const { authenticate } = await import('./account-service')

    expect(
      (
        await authenticate({
          email: 'OWNER@example.com',
          password: PASSWORD,
          fingerprint: FINGERPRINT,
        })
      ).ok,
    ).toBe(true)
  })

  it('refuses a disabled account without saying why', async () => {
    await register('owner@example.com')
    await database.db.update(users).set({ status: 'disabled' })
    const { authenticate } = await import('./account-service')

    expect(
      await authenticate({
        email: 'owner@example.com',
        password: PASSWORD,
        fingerprint: FINGERPRINT,
      }),
    ).toMatchObject({ ok: false, code: 'invalid-credentials' })
  })

  it('rate-limits repeated failures on the same mailbox', async () => {
    await register('owner@example.com')
    const { authenticate } = await import('./account-service')
    const attempt = () =>
      authenticate({
        email: 'owner@example.com',
        password: 'wrong password 1',
        fingerprint: FINGERPRINT,
      })

    const outcomes = []
    for (let index = 0; index < 12; index += 1) outcomes.push(await attempt())

    const limited = outcomes.filter(
      (outcome) => !outcome.ok && outcome.code === 'rate-limited',
    )
    expect(limited.length).toBeGreaterThan(0)
    expect(limited[0]).toHaveProperty('retryAfterMs')
  })
})

describe('resetPassword', () => {
  it('revokes every existing session and issues a fresh one', async () => {
    const registered = await register('owner@example.com')
    if (!registered.ok) throw new Error('registration should succeed')
    const { authenticate, resetPassword } = await import('./account-service')
    const second = await authenticate({
      email: 'owner@example.com',
      password: PASSWORD,
      fingerprint: FINGERPRINT,
    })
    if (!second.ok) throw new Error('login should succeed')
    expect(await database.db.select().from(sessions)).toHaveLength(2)

    const result = await resetPassword({
      email: 'owner@example.com',
      code: await seedCode('owner@example.com', 'password_reset'),
      password: 'brand new secret 9',
      fingerprint: FINGERPRINT,
    })

    expect(result.ok).toBe(true)
    const { resolveSession } = await import('./session')
    expect(await resolveSession(registered.session.token)).toBeNull()
    expect(await resolveSession(second.session.token)).toBeNull()
    if (!result.ok) throw new Error('reset should succeed')
    expect(await resolveSession(result.session.token)).not.toBeNull()
  })

  it('makes the old password stop working and the new one start working', async () => {
    await register('owner@example.com')
    const { authenticate, resetPassword } = await import('./account-service')

    await resetPassword({
      email: 'owner@example.com',
      code: await seedCode('owner@example.com', 'password_reset'),
      password: 'brand new secret 9',
      fingerprint: FINGERPRINT,
    })

    expect(
      await authenticate({
        email: 'owner@example.com',
        password: PASSWORD,
        fingerprint: FINGERPRINT,
      }),
    ).toMatchObject({ ok: false, code: 'invalid-credentials' })
    expect(
      (
        await authenticate({
          email: 'owner@example.com',
          password: 'brand new secret 9',
          fingerprint: FINGERPRINT,
        })
      ).ok,
    ).toBe(true)
  })

  it('does not create an account for an unknown mailbox', async () => {
    const { resetPassword } = await import('./account-service')

    const result = await resetPassword({
      email: 'nobody@example.com',
      code: await seedCode('nobody@example.com', 'password_reset'),
      password: 'brand new secret 9',
      fingerprint: FINGERPRINT,
    })

    expect(result).toMatchObject({ ok: false, code: 'code-invalid' })
    expect(await database.db.select().from(users)).toHaveLength(0)
  })
})

describe('session lifecycle', () => {
  it('logout deletes the server-side row so a copied cookie stops working', async () => {
    const registered = await register('owner@example.com')
    if (!registered.ok) throw new Error('registration should succeed')
    const { resolveSession, revokeSession } = await import('./session')

    await revokeSession(registered.session.token)

    expect(await resolveSession(registered.session.token)).toBeNull()
    expect(await database.db.select().from(sessions)).toHaveLength(0)
  })

  it('stores only a digest of the cookie, never the cookie itself', async () => {
    const registered = await register('owner@example.com')
    if (!registered.ok) throw new Error('registration should succeed')

    const [row] = await database.db.select().from(sessions)
    expect(row?.tokenHash).toHaveLength(64)
    expect(row?.tokenHash).not.toContain(registered.session.token)
  })

  it('rejects an expired session', async () => {
    const registered = await register('owner@example.com')
    if (!registered.ok) throw new Error('registration should succeed')
    // 用固定的过去时刻而不是 DB 的 now()：`resolveSession` 拿应用时钟比较，
    // 两个时钟之间的偏移会让「刚好过期 1 秒」这种边界变得不稳定。
    await database.db.update(sessions).set({ expiresAt: new Date(Date.now() - 60_000) })
    const { resolveSession } = await import('./session')

    expect(await resolveSession(registered.session.token)).toBeNull()
  })

  it('keeps sessions of two accounts strictly separate', async () => {
    const first = await register('a@example.com')
    const second = await register('b@example.com')
    if (!first.ok || !second.ok) throw new Error('registration should succeed')
    const { resolveSession } = await import('./session')

    const ownerA = await resolveSession(first.session.token)
    const ownerB = await resolveSession(second.session.token)
    expect(ownerA?.workspaceId).not.toBe(ownerB?.workspaceId)
    expect(ownerA?.userId).not.toBe(ownerB?.userId)
  })

  it('drops the session when its workspace is deleted', async () => {
    const registered = await register('owner@example.com')
    if (!registered.ok) throw new Error('registration should succeed')
    const [workspace] = await database.db.select().from(workspaces)
    await database.db.delete(workspaces).where(eq(workspaces.id, workspace?.id ?? ''))
    const { resolveSession } = await import('./session')

    expect(await resolveSession(registered.session.token)).toBeNull()
  })
})
