import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { apiAccessCounters, type ApiAccessOutcome } from '@/lib/db/schema'

export function classifyApiAccessOutcome(status: number): ApiAccessOutcome {
  if (status === 401) return '401'
  if (status === 404) return '404'
  if (status >= 500) return '5xx'
  if (status >= 400) return '4xx'
  return '2xx'
}

/** routeGroup 必须是代码内静态分类；不允许把 URL 或用户输入写入观测表。 */
export async function recordApiAccess(routeGroup: string, status: number): Promise<void> {
  try {
    if (!/^[a-z][a-z0-9:_-]{0,79}$/.test(routeGroup)) {
      throw new Error('invalid API route group')
    }
    const database = await getDb()
    await database
      .insert(apiAccessCounters)
      .values({
        routeGroup,
        outcome: classifyApiAccessOutcome(status),
        bucketStartedAt: sql`date_trunc('minute', now())`,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [
          apiAccessCounters.bucketStartedAt,
          apiAccessCounters.routeGroup,
          apiAccessCounters.outcome,
        ],
        set: { count: sql`${apiAccessCounters.count} + 1` },
      })
  } catch {
    console.warn('[auth] API 访问计数失败')
  }
}
