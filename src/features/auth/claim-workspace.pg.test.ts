import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { users, workspaceMembers, workspaces } from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { claimWorkspaceForUser } from './claim-workspace'

/** 归属迁移的幂等性（PLAN-002 §5.5 / §8.2）：连跑两次只有一条成员关系。 */
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn<() => Promise<Db>>() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({
  getDb: getDbMock,
  LOCAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'

let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  getDbMock.mockResolvedValue(database.db)
})

afterAll(async () => {
  await database.close()
})

async function seedUser(email: string): Promise<string> {
  const [row] = await database.db
    .insert(users)
    .values({
      email,
      name: '认领用户',
      passwordHash: 'scrypt$16384$8$1$salt$hash',
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id })
  return row!.id
}

describe('claimWorkspaceForUser', () => {
  it('幂等：连续执行两次只产生一条 owner 成员关系', async () => {
    await database.db
      .insert(workspaces)
      .values({ id: WORKSPACE_ID, slug: 'local', name: 'Local Workspace' })
    const userId = await seedUser('Owner@Example.com')

    // 邮箱按 lower(email) 匹配，大小写不同也认同一个人。
    const first = await claimWorkspaceForUser({
      workspaceId: WORKSPACE_ID,
      email: 'owner@example.com',
    })
    expect(first).toEqual({ ok: true, created: true, userId })

    const second = await claimWorkspaceForUser({
      workspaceId: WORKSPACE_ID,
      email: 'owner@example.com',
    })
    expect(second).toEqual({ ok: true, created: false, userId })

    const members = await database.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, WORKSPACE_ID))
    expect(members).toEqual([{ role: 'owner' }])
  })

  it('未注册邮箱与不存在的 workspace 都如实拒绝，不产生副作用', async () => {
    await expect(
      claimWorkspaceForUser({ workspaceId: WORKSPACE_ID, email: 'nobody@example.com' }),
    ).resolves.toEqual({ ok: false, reason: 'user-not-found' })

    await seedUser('someone@example.com')
    await expect(
      claimWorkspaceForUser({ workspaceId: WORKSPACE_ID, email: 'someone@example.com' }),
    ).resolves.toEqual({ ok: false, reason: 'workspace-not-found' })

    expect(await database.db.select().from(workspaceMembers)).toHaveLength(0)
  })
})
