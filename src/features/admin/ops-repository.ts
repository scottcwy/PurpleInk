import 'server-only'
import { and, count, eq, gt, inArray, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  providerDispatchCooldowns,
  providerDispatches,
  providerPoolStates,
  taskAttempts,
  workflowConcurrencyLeases,
} from '@/lib/db/schema'
import { normalizeTimestamp } from './operational-projections'

interface StatusCount {
  status: string
  count: number
}

export interface AdminOpsSnapshot {
  databaseTime: string
  queue: StatusCount[]
  workflowLeases: StatusCount[]
  providerTickets: StatusCount[]
  activeCooldowns: { provider: string; count: number; latestBlockedUntil: string }[]
  providerPools: {
    provider: string
    scopeCount: number
    currentConcurrency: number
    maxConcurrency: number
    failureCount: number
  }[]
}

export async function getAdminOpsSnapshot(): Promise<AdminOpsSnapshot> {
  const db = await getDb()
  const [clock, queue, workflowLeases, providerTickets, cooldowns, pools] = await Promise.all([
    db.execute(sql<{ database_time: Date }>`select now() as database_time`),
    db.select({ status: taskAttempts.status, count: count() })
      .from(taskAttempts)
      .where(or(
        eq(taskAttempts.status, 'queued'),
        and(
          eq(taskAttempts.status, 'running'),
          gt(taskAttempts.leaseExpiresAt, sql`now()`),
        ),
      ))
      .groupBy(taskAttempts.status),
    db.select({ status: workflowConcurrencyLeases.status, count: count() })
      .from(workflowConcurrencyLeases)
      .where(or(
        eq(workflowConcurrencyLeases.status, 'waiting'),
        and(
          eq(workflowConcurrencyLeases.status, 'active'),
          gt(workflowConcurrencyLeases.leaseExpiresAt, sql`now()`),
        ),
      ))
      .groupBy(workflowConcurrencyLeases.status),
    db.select({ status: providerDispatches.status, count: count() })
      .from(providerDispatches)
      .where(and(
        inArray(providerDispatches.status, ['scheduled', 'in_flight']),
        gt(providerDispatches.leaseExpiresAt, sql`now()`),
      ))
      .groupBy(providerDispatches.status),
    db.select({
      provider: providerDispatchCooldowns.provider,
      count: count(),
      latestBlockedUntil: sql<Date>`max(${providerDispatchCooldowns.blockedUntil})`,
    }).from(providerDispatchCooldowns)
      .where(gt(providerDispatchCooldowns.blockedUntil, sql`now()`))
      .groupBy(providerDispatchCooldowns.provider),
    db.select({
      provider: providerPoolStates.provider,
      scopeCount: count(),
      currentConcurrency: sql<number>`coalesce(sum(${providerPoolStates.currentConcurrency}), 0)::int`,
      maxConcurrency: sql<number>`coalesce(sum(${providerPoolStates.maxConcurrency}), 0)::int`,
      failureCount: sql<number>`coalesce(sum(${providerPoolStates.failureCount}), 0)::int`,
    }).from(providerPoolStates).groupBy(providerPoolStates.provider),
  ])
  const databaseTime = clock[0]?.database_time
  if (!databaseTime) throw new Error('admin ops database clock unavailable')
  return {
    databaseTime: normalizeTimestamp(databaseTime),
    queue,
    workflowLeases,
    providerTickets,
    activeCooldowns: cooldowns.map((row) => ({
      provider: row.provider,
      count: row.count,
      latestBlockedUntil: normalizeTimestamp(row.latestBlockedUntil),
    })),
    providerPools: pools,
  }
}
