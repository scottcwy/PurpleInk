import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema/index'

/**
 * DAU / 活跃统计（管理后台概览消费）。
 *
 * 口径（计划 Assumptions）：DAU = 当日有会话活跃（`sessions.lastSeenAt` 落在当日）
 * 的去重用户数。lastSeenAt 有 5 分钟节流但足够按天聚合；它会被后续活跃覆盖，
 * 因此历史天数是「近似值下界」——够运营看趋势，不做计费依据。
 * 全部纯 SQL 聚合，不建新表；日界取 DB 时钟的自然日。
 */

export const DAU_DAYS_MAX = 90

export interface DailyMetric {
  /** YYYY-MM-DD（DB 时区自然日）。 */
  date: string
  dau: number
  newUsers: number
}

export interface DauMetrics {
  days: DailyMetric[]
  totalUsers: number
  dauToday: number
  wau: number
  mau: number
}

export async function getDauMetrics(days: number): Promise<DauMetrics> {
  const database = await getDb()
  const window = Math.min(Math.max(Math.trunc(days), 1), DAU_DAYS_MAX)

  const daily = await database.execute<{
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
  `)

  const [summary] = await database.execute<{
    total_users: number
    wau: number
    mau: number
  }>(sql`
    select
      (select count(*)::int from ${users}) as total_users,
      (
        select count(distinct ${sessions.userId})::int from ${sessions}
        where ${sessions.lastSeenAt} >= now() - interval '7 days'
      ) as wau,
      (
        select count(distinct ${sessions.userId})::int from ${sessions}
        where ${sessions.lastSeenAt} >= now() - interval '30 days'
      ) as mau
  `)

  const dayRows = [...daily].map((row) => ({
    date: row.date,
    dau: row.dau,
    newUsers: row.new_users,
  }))
  return {
    days: dayRows,
    totalUsers: summary?.total_users ?? 0,
    dauToday: dayRows.at(-1)?.dau ?? 0,
    wau: summary?.wau ?? 0,
    mau: summary?.mau ?? 0,
  }
}
