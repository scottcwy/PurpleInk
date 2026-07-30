import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema/index'
import { withTransaction } from '@/lib/db/transaction'
import {
  createUserWithWorkspace,
  findUserByEmail,
} from '@/features/auth/auth-repository'
import { hashPassword } from '@/features/auth/password'

/**
 * 管理后台的账号增删改查（仅 withAdminSession 内消费）。
 *
 * 与产品注册路径的关系：建号复用 `createUserWithWorkspace` 的原子边界
 * （user + workspace + owner + Free 权益同生同死），只是跳过验证码、直接标记
 * 邮箱已验证——与 seed-owner-account 脚本同口径。
 */

export const ADMIN_USERS_PAGE_SIZE_MAX = 100

export interface AdminUserRow {
  id: string
  email: string
  name: string
  status: string
  role: string
  createdAt: Date
  /** 该用户所有会话中最近一次活跃时间；从未登录则为 null。 */
  lastSeenAt: Date | null
}

export interface AdminUserList {
  users: AdminUserRow[]
  total: number
  page: number
  pageSize: number
}

export async function listAdminUsers(input: {
  search?: string
  page: number
  pageSize: number
}): Promise<AdminUserList> {
  const database = await getDb()
  const pageSize = Math.min(Math.max(input.pageSize, 1), ADMIN_USERS_PAGE_SIZE_MAX)
  const page = Math.max(input.page, 1)
  const search = input.search?.trim().toLowerCase()
  // ILIKE 需转义通配符，否则搜索串里的 % 会变成全表匹配。
  const pattern = search
    ? `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
    : null
  const where = pattern
    ? sql`(${users.email} ilike ${pattern} or ${users.name} ilike ${pattern})`
    : sql`true`

  const rows = await database
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      status: users.status,
      role: users.role,
      createdAt: users.createdAt,
      // 注意：必须手写限定名。drizzle 单表查询会把 `${users.id}` 渲染成不带表前缀
      // 的 "id"，在子查询里会被内层作用域解析为 sessions.id，关联条件永远不成立。
      lastSeenAt: sql<Date | null>`(
        select max(s.last_seen_at) from sessions s
        where s.user_id = users.id
      )`,
    })
    .from(users)
    .where(where)
    .orderBy(sql`${users.createdAt} desc`)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  const [counted] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(where)

  return { users: rows, total: counted?.total ?? 0, page, pageSize }
}

export type AdminUserMutationFailure =
  | { ok: false; code: 'email-taken' }
  | { ok: false; code: 'not-found' }
  | { ok: false; code: 'self-forbidden' }

export type AdminUserMutationResult =
  | { ok: true; userId: string }
  | AdminUserMutationFailure

export async function createAdminUser(input: {
  email: string
  name: string
  password: string
  role: 'user' | 'admin'
}): Promise<AdminUserMutationResult> {
  if (await findUserByEmail(input.email)) return { ok: false, code: 'email-taken' }
  const { userId } = await createUserWithWorkspace({
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    workspaceName: `${input.name} 的 Workspace`,
    // 管理端建号跳过验证码，直接视为已验证（同 seed 脚本口径）。
    emailVerifiedAt: new Date(),
    role: input.role,
  })
  return { ok: true, userId }
}

export interface AdminUserPatch {
  name?: string
  status?: 'active' | 'disabled'
  role?: 'user' | 'admin'
  password?: string
}

/**
 * 更新账号。禁用与改口令都会**删除该用户全部会话**（即时踢下线），
 * 与 password reset 的口径一致。禁止 admin 对自己禁用/降级——否则最后一个
 * 管理员可以把自己锁死在后台之外。
 */
export async function updateAdminUser(input: {
  userId: string
  actorUserId: string
  patch: AdminUserPatch
}): Promise<AdminUserMutationResult> {
  const { userId, actorUserId, patch } = input
  const selfLockout =
    userId === actorUserId && (patch.status === 'disabled' || patch.role === 'user')
  if (selfLockout) return { ok: false, code: 'self-forbidden' }

  const database = await getDb()
  const passwordHash = patch.password ? await hashPassword(patch.password) : null
  return withTransaction(database, async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(passwordHash
          ? {
              passwordHash,
              // 与 updatePasswordAndRevokeSessions 同理：时间戳取 DB 时钟。
              passwordUpdatedAt: sql`now()`,
            }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id })
    if (!updated) return { ok: false, code: 'not-found' } as const
    if (patch.status === 'disabled' || passwordHash) {
      await tx.delete(sessions).where(eq(sessions.userId, userId))
    }
    return { ok: true, userId: updated.id } as const
  })
}

/**
 * 硬删账号：sessions / workspace_members 由外键 cascade 清理；用户名下的
 * workspace 行保留（其中可能有项目数据，删除策略留给运维决策）。
 * 日常运营建议用禁用而不是删除。
 */
export async function deleteAdminUser(input: {
  userId: string
  actorUserId: string
}): Promise<AdminUserMutationResult> {
  if (input.userId === input.actorUserId) return { ok: false, code: 'self-forbidden' }
  const database = await getDb()
  const [deleted] = await database
    .delete(users)
    .where(eq(users.id, input.userId))
    .returning({ id: users.id })
  if (!deleted) return { ok: false, code: 'not-found' }
  return { ok: true, userId: deleted.id }
}
