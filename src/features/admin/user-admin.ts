import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { createUserWithWorkspace } from '@/features/auth/auth-repository'
import {
  displayNameSchema,
  emailSchema,
  passwordSchema,
  workspaceNameSchema,
} from '@/features/auth/schemas'
import { hashPassword } from '@/features/auth/password'
import { getDb } from '@/lib/db/client'
import { sessions, users, workspaceMembers } from '@/lib/db/schema'

export type UserAdminErrorCode =
  | 'INVALID_INPUT'
  | 'EMAIL_IN_USE'
  | 'USER_NOT_FOUND'
  | 'SELF_DISABLE'
  | 'LAST_ACTIVE_ADMIN'

export class UserAdminError extends Error {
  constructor(readonly code: UserAdminErrorCode, message: string) {
    super(message)
    this.name = 'UserAdminError'
  }
}

export interface AdminUserRow {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
  status: 'active' | 'disabled'
  workspaceCount: number
  activeSessionCount: number
  createdAt: string
}

export type AdminUserMutation = Pick<
  AdminUserRow,
  'id' | 'email' | 'name' | 'role' | 'status' | 'createdAt'
>

export async function listAdminUsers(input: {
  q?: string
  page?: number
  pageSize?: number
} = {}): Promise<{ items: AdminUserRow[]; total: number; page: number; pageSize: number }> {
  const database = await getDb()
  const page = positiveInteger(input.page, 1)
  const pageSize = Math.min(positiveInteger(input.pageSize, 50), 100)
  const q = input.q?.trim()
  const pattern = q ? `%${escapeLikePattern(q)}%` : undefined
  const condition = pattern
    ? sql<boolean>`(${users.email} ilike ${pattern} escape '!' or ${users.name} ilike ${pattern} escape '!')`
    : undefined
  const [rows, totalRows] = await Promise.all([
    database.select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      workspaceCount: sql<number>`count(distinct ${workspaceMembers.workspaceId})::int`,
      activeSessionCount: sql<number>`count(distinct ${sessions.id}) filter (where ${sessions.expiresAt} > now())::int`,
      createdAt: users.createdAt,
    }).from(users)
      .leftJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .leftJoin(sessions, eq(sessions.userId, users.id))
      .where(condition)
      .groupBy(users.id)
      .orderBy(sql`${users.createdAt} desc`)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    database.select({ count: sql<number>`count(*)::int` }).from(users).where(condition),
  ])
  return {
    items: rows.map((row) => ({
      ...assertAdminUserEnums(row),
      workspaceCount: row.workspaceCount,
      activeSessionCount: row.activeSessionCount,
      createdAt: row.createdAt.toISOString(),
    })),
    total: totalRows[0]?.count ?? 0,
    page,
    pageSize,
  }
}

export async function createAdminUser(input: {
  email: string
  name: string
  password: string
  workspaceName: string
}): Promise<{ id: string; workspaceId: string }> {
  const parsed = parseCreateInput(input)
  try {
    const created = await createUserWithWorkspace({
      email: parsed.email,
      name: parsed.name,
      passwordHash: await hashPassword(parsed.password),
      workspaceName: parsed.workspaceName,
      emailVerifiedAt: new Date(),
    })
    return { id: created.userId, workspaceId: created.workspaceId }
  } catch (error) {
    if (postgresCode(error) === '23505') {
      throw new UserAdminError('EMAIL_IN_USE', '邮箱已被使用')
    }
    throw error
  }
}

export async function updateAdminUser(input: {
  actorUserId: string
  targetUserId: string
  patch: { email?: string; name?: string; status?: 'active' | 'disabled' }
}): Promise<AdminUserMutation> {
  const patch = parseUpdateInput(input.patch)
  const database = await getDb()
  try {
    return await database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('purpleink:admin-user-status'))`)
      const [target] = await tx.select().from(users)
        .where(eq(users.id, input.targetUserId)).for('update')
      if (!target) throw new UserAdminError('USER_NOT_FOUND', '用户不存在')
      if (patch.status === 'disabled' && input.actorUserId === input.targetUserId) {
        throw new UserAdminError('SELF_DISABLE', '不能停用当前管理员账号')
      }
      if (patch.status === 'disabled' && target.role === 'admin' && target.status === 'active') {
        const [remaining] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(users).where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
        if ((remaining?.count ?? 0) <= 1) {
          throw new UserAdminError('LAST_ACTIVE_ADMIN', '不能停用最后一个活跃管理员')
        }
      }
      const [updated] = await tx.update(users).set({
        ...(patch.email ? { email: patch.email } : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        updatedAt: sql`now()`,
      }).where(eq(users.id, target.id)).returning()
      if (patch.status === 'disabled') {
        await tx.delete(sessions).where(eq(sessions.userId, target.id))
      }
      const safe = assertAdminUserEnums(updated!)
      return {
        ...safe,
        createdAt: updated!.createdAt.toISOString(),
      }
    })
  } catch (error) {
    if (postgresCode(error) === '23505') {
      throw new UserAdminError('EMAIL_IN_USE', '邮箱已被使用')
    }
    throw error
  }
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[!%_]/g, (character) => `!${character}`)
}

function parseCreateInput(input: {
  email: string
  name: string
  password: string
  workspaceName: string
}) {
  const result = {
    email: emailSchema.safeParse(input.email),
    name: displayNameSchema.safeParse(input.name),
    password: passwordSchema.safeParse(input.password),
    workspaceName: workspaceNameSchema.safeParse(input.workspaceName),
  }
  if (Object.values(result).some((item) => !item.success)) {
    throw new UserAdminError('INVALID_INPUT', '账号资料格式不正确')
  }
  return {
    email: result.email.data!,
    name: result.name.data!,
    password: result.password.data!,
    workspaceName: result.workspaceName.data!,
  }
}

function parseUpdateInput(input: { email?: string; name?: string; status?: string }) {
  const email = input.email === undefined ? undefined : emailSchema.safeParse(input.email)
  const name = input.name === undefined ? undefined : displayNameSchema.safeParse(input.name)
  const status = input.status
  if (
    (email && !email.success)
    || (name && !name.success)
    || (status !== undefined && status !== 'active' && status !== 'disabled')
    || (email === undefined && name === undefined && status === undefined)
  ) {
    throw new UserAdminError('INVALID_INPUT', '账号更新内容格式不正确')
  }
  return {
    ...(email ? { email: email.data! } : {}),
    ...(name ? { name: name.data! } : {}),
    ...(status ? { status } : {}),
  } as { email?: string; name?: string; status?: 'active' | 'disabled' }
}

function assertAdminUserEnums<T extends { role: string; status: string }>(row: T): Omit<T, 'role' | 'status'> & {
  role: 'user' | 'admin'
  status: 'active' | 'disabled'
} {
  if ((row.role !== 'user' && row.role !== 'admin')
    || (row.status !== 'active' && row.status !== 'disabled')) {
    throw new Error('user row violates role or status contract')
  }
  return {
    ...row,
    role: row.role as 'user' | 'admin',
    status: row.status as 'active' | 'disabled',
  }
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : fallback
}
