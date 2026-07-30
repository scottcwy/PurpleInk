import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { aiInvocations } from '@/lib/db/schema/index'

/**
 * AI 调用审计聚合（/admin/ai 消费）：跨 workspace 只读聚合，不展示单 workspace
 * 明细 PII。纯 SQL，无新表。成本以 settled_cny_micros（微元）求和，展示时 /1e6 转元。
 */

const DEFAULT_WINDOW_DAYS = 30
const MAX_WINDOW_DAYS = 90

export interface AiDailyPoint {
  date: string
  total: number
  succeeded: number
  failed: number
}

export interface AiFailurePoint {
  failureKind: string
  count: number
}

export interface AiModelPoint {
  provider: string
  model: string
  count: number
  avgDurationMs: number | null
}

export interface AiAuditMetrics {
  windowDays: number
  totalInvocations: number
  succeeded: number
  failed: number
  successRate: number | null
  totalCostCny: number
  days: AiDailyPoint[]
  failures: AiFailurePoint[]
  topModels: AiModelPoint[]
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function getAiAuditMetrics(days: number = DEFAULT_WINDOW_DAYS): Promise<AiAuditMetrics> {
  const database = await getDb()
  const windowDays = Math.min(Math.max(Math.trunc(days) || DEFAULT_WINDOW_DAYS, 1), MAX_WINDOW_DAYS)
  // 窗口起点对齐到自然日，含今天共 windowDays 天。
  const windowStart = sql`date_trunc('day', now()) - (${windowDays - 1}) * interval '1 day'`
  const inWindow = sql`${aiInvocations.createdAt} >= ${windowStart}`

  const [dailyRows, totalsRows, failureRows, modelRows] = await Promise.all([
    database
      .select({
        date: sql<string>`to_char(date_trunc('day', ${aiInvocations.createdAt}), 'YYYY-MM-DD')`,
        total: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${aiInvocations.status} = 'succeeded')::int`,
        failed: sql<number>`count(*) filter (where ${aiInvocations.status} = 'failed')::int`,
      })
      .from(aiInvocations)
      .where(inWindow)
      .groupBy(sql`date_trunc('day', ${aiInvocations.createdAt})`)
      .orderBy(sql`date_trunc('day', ${aiInvocations.createdAt})`),
    database
      .select({
        total: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${aiInvocations.status} = 'succeeded')::int`,
        failed: sql<number>`count(*) filter (where ${aiInvocations.status} = 'failed')::int`,
        cost: sql<string>`coalesce(sum(${aiInvocations.settledCnyMicros}), 0)`,
      })
      .from(aiInvocations)
      .where(inWindow),
    database
      .select({
        failureKind: sql<string>`coalesce(${aiInvocations.failureKind}, 'unknown')`,
        count: sql<number>`count(*)::int`,
      })
      .from(aiInvocations)
      .where(and(inWindow, eq(aiInvocations.status, 'failed')))
      .groupBy(sql`coalesce(${aiInvocations.failureKind}, 'unknown')`)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
    database
      .select({
        provider: aiInvocations.provider,
        model: aiInvocations.model,
        count: sql<number>`count(*)::int`,
        avgDurationMs: sql<string | null>`avg(${aiInvocations.providerDurationMs})`,
      })
      .from(aiInvocations)
      .where(inWindow)
      .groupBy(aiInvocations.provider, aiInvocations.model)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ])

  const totals = totalsRows[0]
  const totalInvocations = totals?.total ?? 0
  const succeeded = totals?.succeeded ?? 0
  const failed = totals?.failed ?? 0
  const settled = succeeded + failed

  return {
    windowDays,
    totalInvocations,
    succeeded,
    failed,
    successRate: settled > 0 ? succeeded / settled : null,
    totalCostCny: (toNum(totals?.cost) ?? 0) / 1e6,
    days: fillDailyGaps(dailyRows, windowDays),
    failures: failureRows,
    topModels: modelRows.map((row) => ({
      provider: row.provider,
      model: row.model,
      count: row.count,
      avgDurationMs: toNum(row.avgDurationMs),
    })),
  }
}

/** 把稀疏的按天聚合补齐为连续 windowDays 天（缺失天补 0），供柱状图渲染。 */
function fillDailyGaps(rows: AiDailyPoint[], windowDays: number): AiDailyPoint[] {
  const byDate = new Map(rows.map((row) => [row.date, row]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const out: AiDailyPoint[] = []
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    out.push(byDate.get(key) ?? { date: key, total: 0, succeeded: 0, failed: 0 })
  }
  return out
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
