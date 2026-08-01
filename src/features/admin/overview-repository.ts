import 'server-only'
import { count, eq, gt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import { normalizeTimestamp } from './operational-projections'

export interface AdminOverview {
  databaseTime: string
  users: { total: number; active: number; disabled: number }
  activeSessions: number
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const db = await getDb()
  const [clockRows, totalRows, activeRows, disabledRows, sessionRows] = await Promise.all([
    db.execute(sql<{ database_time: Date }>`select now() as database_time`),
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(users).where(eq(users.status, 'active')),
    db.select({ value: count() }).from(users).where(eq(users.status, 'disabled')),
    db.select({ value: count() }).from(sessions).where(gt(sessions.expiresAt, sql`now()`)),
  ])
  const databaseTime = clockRows[0]?.database_time
  if (!databaseTime) throw new Error('admin overview database clock unavailable')
  return {
    databaseTime: normalizeTimestamp(databaseTime),
    users: {
      total: totalRows[0]?.value ?? 0,
      active: activeRows[0]?.value ?? 0,
      disabled: disabledRows[0]?.value ?? 0,
    },
    activeSessions: sessionRows[0]?.value ?? 0,
  }
}
