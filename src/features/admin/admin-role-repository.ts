import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { users, type UserRole } from '@/lib/db/schema'

export type SetUserRoleResult =
  | { outcome: 'updated'; userId: string; previousRole: UserRole; role: UserRole }
  | { outcome: 'not_found' }
  | { outcome: 'last_active_admin' }

/** 事务级 advisory lock 让并发降权不能同时绕过“最后一个活跃管理员”判断。 */
export async function setUserRoleByEmail(input: {
  email: string
  role: UserRole
}): Promise<SetUserRoleResult> {
  const database = await getDb()
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('purpleink:admin-role'))`)
    const [target] = await tx
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1)
    if (!target) return { outcome: 'not_found' }
    if (target.role !== 'user' && target.role !== 'admin') {
      throw new Error('users.role violates the global role contract')
    }
    if (target.role === 'admin' && input.role === 'user' && target.status === 'active') {
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
      if ((remaining?.count ?? 0) <= 1) return { outcome: 'last_active_admin' }
    }
    await tx
      .update(users)
      .set({ role: input.role, updatedAt: sql`now()` })
      .where(eq(users.id, target.id))
    return {
      outcome: 'updated',
      userId: target.id,
      previousRole: target.role,
      role: input.role,
    }
  })
}
