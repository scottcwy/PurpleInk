import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'

export interface AdminDailyMetric {
  date: string
  dau: number
  newUsers: number
}

export interface AdminDauMetrics {
  days: AdminDailyMetric[]
  totalUsers: number
  dauToday: number
  wau: number
  mau: number
}

export async function getAdminDauMetrics(days = 30): Promise<AdminDauMetrics> {
  const db = await getDb()
  const window = Math.min(Math.max(Math.trunc(days), 1), 90)
  const [daily, summaryRows] = await Promise.all([
    db.execute<{
      date: string
      dau: number
      new_users: number
    }>(sql`
      with day as (
        select generate_series(
          date_trunc('day', now()) - make_interval(days => ${window - 1}),
          date_trunc('day', now()),
          interval '1 day'
        ) as d
      )
      select
        to_char(day.d, 'YYYY-MM-DD') as date,
        (
          select count(distinct ${sessions.userId})::int from ${sessions}
          where ${sessions.lastSeenAt} >= day.d
            and ${sessions.lastSeenAt} < day.d + interval '1 day'
        ) as dau,
        (
          select count(*)::int from ${users}
          where ${users.createdAt} >= day.d
            and ${users.createdAt} < day.d + interval '1 day'
        ) as new_users
      from day
      order by day.d
    `),
    db.execute<{
      total_users: number
      wau: number
      mau: number
    }>(sql`
      select
        (select count(*)::int from ${users}) as total_users,
        (select count(distinct ${sessions.userId})::int from ${sessions}
          where ${sessions.lastSeenAt} >= now() - interval '7 days') as wau,
        (select count(distinct ${sessions.userId})::int from ${sessions}
          where ${sessions.lastSeenAt} >= now() - interval '30 days') as mau
    `),
  ])
  const dayRows = [...daily].map((row) => ({
    date: row.date,
    dau: row.dau,
    newUsers: row.new_users,
  }))
  const summary = summaryRows[0]
  return {
    days: dayRows,
    totalUsers: summary?.total_users ?? 0,
    dauToday: dayRows.at(-1)?.dau ?? 0,
    wau: summary?.wau ?? 0,
    mau: summary?.mau ?? 0,
  }
}
