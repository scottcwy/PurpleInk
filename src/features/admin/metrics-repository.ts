import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'

export interface AdminLastSessionActivityDay {
  date: string
  usersWithLastSessionActivity: number
  newUsers: number
}

export interface AdminLastSessionActivityMetrics {
  metric: 'last_session_activity'
  snapshotNature: 'mutable'
  historicalDau: false
  days: AdminLastSessionActivityDay[]
  totalUsers: number
  usersWithLastSessionActivityToday: number
  usersWithLastSessionActivity7d: number
  usersWithLastSessionActivity30d: number
}

/**
 * Groups the current sessions.last_seen_at snapshot. A later activity update moves the same
 * session between buckets, so these values are intentionally not presented as historical DAU.
 */
export async function getAdminLastSessionActivityMetrics(
  days = 30,
): Promise<AdminLastSessionActivityMetrics> {
  const db = await getDb()
  const window = Math.min(Math.max(Math.trunc(days), 1), 90)
  const [daily, summaryRows] = await Promise.all([
    db.execute<{
      date: string
      users_with_last_session_activity: number
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
        ) as users_with_last_session_activity,
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
      users_with_last_session_activity_7d: number
      users_with_last_session_activity_30d: number
    }>(sql`
      select
        (select count(*)::int from ${users}) as total_users,
        (select count(distinct ${sessions.userId})::int from ${sessions}
          where ${sessions.lastSeenAt} >= now() - interval '7 days')
          as users_with_last_session_activity_7d,
        (select count(distinct ${sessions.userId})::int from ${sessions}
          where ${sessions.lastSeenAt} >= now() - interval '30 days')
          as users_with_last_session_activity_30d
    `),
  ])
  const dayRows = [...daily].map((row) => ({
    date: row.date,
    usersWithLastSessionActivity: row.users_with_last_session_activity,
    newUsers: row.new_users,
  }))
  const summary = summaryRows[0]
  return {
    metric: 'last_session_activity',
    snapshotNature: 'mutable',
    historicalDau: false,
    days: dayRows,
    totalUsers: summary?.total_users ?? 0,
    usersWithLastSessionActivityToday:
      dayRows.at(-1)?.usersWithLastSessionActivity ?? 0,
    usersWithLastSessionActivity7d:
      summary?.users_with_last_session_activity_7d ?? 0,
    usersWithLastSessionActivity30d:
      summary?.users_with_last_session_activity_30d ?? 0,
  }
}
