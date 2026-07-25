import 'server-only'
import { and, eq, lt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  authThrottle,
  emailVerificationCodes,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema/index'
import { withTransaction } from '@/lib/db/transaction'

export interface UserRecord {
  id: string
  email: string
  name: string
  passwordHash: string
  passwordUpdatedAt: Date
  emailVerifiedAt: Date | null
  status: string
}

export interface SessionOwner {
  userId: string
  workspaceId: string
  email: string
  name: string
  sessionId: string
}

/** 按 `lower(email)` 查，与 `users_email_lower_unique` 索引同口径（可走索引）。 */
export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const database = await getDb()
  const [row] = await database
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      passwordUpdatedAt: users.passwordUpdatedAt,
      emailVerifiedAt: users.emailVerifiedAt,
      status: users.status,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1)
  return row ?? null
}

/**
 * 注册的原子边界（§8.2）：user + workspace + owner 成员关系必须同生同死，
 * 任一步失败全回滚，绝不留下「有账号但没有 workspace」的半成品。
 *
 * workspace 的创建点唯一在这里——`createProject()` 里那段 upsert
 * `LOCAL_WORKSPACE_ID` 的逻辑在阶段 B 删除（§5.2）。
 */
export async function createUserWithWorkspace(input: {
  email: string
  name: string
  passwordHash: string
  workspaceName: string
  emailVerifiedAt: Date
}): Promise<{ userId: string; workspaceId: string }> {
  const database = await getDb()
  return withTransaction(database, async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        emailVerifiedAt: input.emailVerifiedAt,
      })
      .returning({ id: users.id })
    if (!user) throw new Error('user insert returned no row')

    const [workspace] = await tx
      .insert(workspaces)
      .values({ slug: await allocateSlug(tx, input.workspaceName), name: input.workspaceName })
      .returning({ id: workspaces.id })
    if (!workspace) throw new Error('workspace insert returned no row')

    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    return { userId: user.id, workspaceId: workspace.id }
  })
}

type Transaction = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>['transaction']>[0]>[0]

/**
 * `workspaces.slug` 有唯一约束。按名称做可读 slug，冲突时追加短随机后缀；
 * 重试有限次后放弃并抛错，不做无界循环。
 */
async function allocateSlug(tx: Transaction, workspaceName: string): Promise<string> {
  const base =
    workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`
    const [taken] = await tx
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1)
    if (!taken) return candidate
  }
  throw new Error('workspace slug allocation failed')
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** 登录后解析默认 workspace：首版每人恰好一条 owner 关系。 */
export async function findPrimaryWorkspaceId(userId: string): Promise<string | null> {
  const database = await getDb()
  const [row] = await database
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaceMembers.createdAt)
    .limit(1)
  return row?.workspaceId ?? null
}

export async function insertSession(input: {
  tokenHash: string
  userId: string
  workspaceId: string
  expiresAt: Date
  userAgentHash: string | null
  ipHash: string | null
}): Promise<void> {
  const database = await getDb()
  await database.insert(sessions).values(input)
}

/**
 * 解析会话。三道校验一起做，避免「登出了还能用」「改密码没踢下线」：
 * 未过期、用户 active、会话创建时间不早于最近一次改密。
 */
export async function findSessionOwner(
  tokenHash: string,
  now: Date,
): Promise<SessionOwner | null> {
  const database = await getDb()
  const [row] = await database
    .select({
      sessionId: sessions.id,
      userId: users.id,
      workspaceId: sessions.workspaceId,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        sql`${sessions.expiresAt} > ${now}`,
        eq(users.status, 'active'),
        sql`${users.passwordUpdatedAt} <= ${sessions.createdAt}`,
      ),
    )
    .limit(1)
  return row ?? null
}

export async function touchSession(sessionId: string, now: Date): Promise<void> {
  const database = await getDb()
  await database.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId))
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  const database = await getDb()
  await database.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
}

/**
 * 改口令：写新哈希 + 推进 `passwordUpdatedAt`，并**删除该用户全部会话**。
 * 删除是显式的，不依赖 `passwordUpdatedAt <= createdAt` 那道软校验兜底，
 * 这样「改密即全端登出」在数据层就成立。
 */
export async function updatePasswordAndRevokeSessions(input: {
  userId: string
  passwordHash: string
  now: Date
}): Promise<void> {
  const database = await getDb()
  await withTransaction(database, async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash: input.passwordHash,
        passwordUpdatedAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(users.id, input.userId))
    await tx.delete(sessions).where(eq(sessions.userId, input.userId))
  })
}

/**
 * 过期数据的清理路径（§2.2）：挂在签发会话 / 签发验证码这些低频写入路径上顺手做，
 * 不新增后台定时任务——那会成为第二套调度真值。
 */
export async function pruneExpiredAuthRows(now: Date, throttleWindowMs: number): Promise<void> {
  const database = await getDb()
  await database.delete(sessions).where(lt(sessions.expiresAt, now))
  await database
    .delete(emailVerificationCodes)
    .where(lt(emailVerificationCodes.expiresAt, now))
  await database
    .delete(authThrottle)
    .where(lt(authThrottle.windowStartedAt, new Date(now.getTime() - throttleWindowMs)))
}

/** 首个 owner 关系是否已存在——归属迁移脚本（§5.5）的幂等判据。 */
export async function findMembership(
  workspaceId: string,
  userId: string,
): Promise<{ role: string } | null> {
  const database = await getDb()
  const [row] = await database
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .limit(1)
  return row ?? null
}
