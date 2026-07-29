import 'server-only'
import { eq, gt, sql } from 'drizzle-orm'
import type { PlanKey } from '@/features/billing/domain'
import { subscriptionConcurrencyLimit } from '@/features/billing/domain'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { workflowConcurrencyLeases } from '@/lib/db/schema'
import { activePlan, databaseNow } from './workspace-concurrency-context'

export interface WorkspaceConcurrencyProjection {
  planKey: PlanKey
  limit: number
  active: number
  waiting: number
}

/** 客户端安全投影：只返回当前账号自己的套餐上限与队列计数。 */
export async function getWorkspaceConcurrencyProjection(
  input: { database?: Db; workspaceId?: string } = {},
): Promise<WorkspaceConcurrencyProjection> {
  const database = input.database ?? await getDb()
  const workspaceId = input.workspaceId ?? currentWorkspaceId()
  return database.transaction(async (transaction) => {
    const now = await databaseNow(transaction, workspaceId)
    const planKey = await activePlan(transaction, workspaceId, now)
    const [counts] = await transaction
      .select({
        active: sql<number>`count(*) filter (
          where ${workflowConcurrencyLeases.status} = 'active'
          and ${gt(workflowConcurrencyLeases.leaseExpiresAt, now)}
        )::int`,
        waiting: sql<number>`count(*) filter (
          where ${workflowConcurrencyLeases.status} = 'waiting'
        )::int`,
      })
      .from(workflowConcurrencyLeases)
      .where(eq(workflowConcurrencyLeases.workspaceId, workspaceId))
    return {
      planKey,
      limit: subscriptionConcurrencyLimit(planKey),
      active: counts?.active ?? 0,
      waiting: counts?.waiting ?? 0,
    }
  })
}
