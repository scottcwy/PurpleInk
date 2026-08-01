import 'server-only'
import { count, gte, sql, sum } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { apiAccessCounters, authThrottle } from '@/lib/db/schema'

export interface AdminSecuritySnapshot {
  windowHours: 24
  apiAccess: { routeGroup: string; outcome: string; count: number }[]
  authThrottle: { trackedBuckets: number; attempts: number }
}

export async function getAdminSecuritySnapshot(): Promise<AdminSecuritySnapshot> {
  const db = await getDb()
  const [apiAccess, throttleRows] = await Promise.all([
    db.select({
      routeGroup: apiAccessCounters.routeGroup,
      outcome: apiAccessCounters.outcome,
      count: sql<number>`coalesce(sum(${apiAccessCounters.count}), 0)::int`,
    }).from(apiAccessCounters)
      .where(gte(apiAccessCounters.bucketStartedAt, sql`now() - interval '24 hours'`))
      .groupBy(apiAccessCounters.routeGroup, apiAccessCounters.outcome),
    db.select({
      trackedBuckets: count(),
      attempts: sql<number>`coalesce(${sum(authThrottle.count)}, 0)::int`,
    }).from(authThrottle)
      .where(gte(authThrottle.windowStartedAt, sql`now() - interval '24 hours'`)),
  ])
  return {
    windowHours: 24,
    apiAccess,
    authThrottle: {
      trackedBuckets: throttleRows[0]?.trackedBuckets ?? 0,
      attempts: throttleRows[0]?.attempts ?? 0,
    },
  }
}
