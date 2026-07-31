import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { users, workspaceMembers, workspaces } from '@/lib/db/schema/index'
import { eq } from 'drizzle-orm'

/**
 * 既有数据的归属认领（PLAN-002 §5.5）。
 *
 * 把一个已注册用户与指定 workspace（默认历史单工作区 `LOCAL_WORKSPACE_ID`）
 * 建立 `workspace_members(owner)` 关系——不搬数据、不改任何行的 workspaceId，
 * 这是最小且可逆的做法。幂等：重复执行不报错、不产生第二条成员关系。
 *
 * 只在 `scripts/migration/claim-local-workspace.ts` 与 pg 测试中消费，
 * 不进任何请求路径。
 */
export type ClaimWorkspaceResult =
  | { ok: true; created: boolean; userId: string }
  | { ok: false; reason: 'user-not-found' | 'workspace-not-found' }

export async function claimWorkspaceForUser(input: {
  workspaceId: string
  email: string
}): Promise<ClaimWorkspaceResult> {
  const database = await getDb()

  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email.trim().toLowerCase()}`)
    .limit(1)
  if (!user) return { ok: false, reason: 'user-not-found' }

  const [workspace] = await database
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .limit(1)
  if (!workspace) return { ok: false, reason: 'workspace-not-found' }

  // (workspaceId, userId) 是主键：冲突即已认领过，onConflictDoNothing 保证幂等。
  const inserted = await database
    .insert(workspaceMembers)
    .values({ workspaceId: input.workspaceId, userId: user.id, role: 'owner' })
    .onConflictDoNothing()
    .returning({ userId: workspaceMembers.userId })

  return { ok: true, created: inserted.length > 0, userId: user.id }
}
