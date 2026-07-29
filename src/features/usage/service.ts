import 'server-only'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  gt,
  isNotNull,
  lte,
  sql,
} from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  aiInvocations,
  telemetryCutovers,
  usagePeriods,
} from '@/lib/db/schema'
import {
  breakdown,
  buildSeries,
  isActualUsageRow,
  summarize,
  type UsageRow,
} from './aggregation'
import type {
  AiUsageProjectionV1,
  AiUsageRange,
  AiUsageView,
} from './contracts'
import { dateKeysBetween, recentDateKeys, zonedStart } from './time-range'

export async function getAiUsageProjection(input: {
  userId: string
  view: AiUsageView
  range: AiUsageRange
  timeZone: string
}): Promise<AiUsageProjectionV1> {
  const database = await getDb()
  const [cutover] = await database.select({
    cutoverAt: telemetryCutovers.cutoverAt,
  }).from(telemetryCutovers)
    .where(eq(telemetryCutovers.key, 'ai_invocation_v2'))
    .limit(1)
  if (!cutover) throw new Error('AI telemetry cutover is missing')

  const scoped = input.view === 'account'
    ? await accountRows(input.userId, input.range, input.timeZone)
    : await managedCycleRows(input.timeZone)
  const series = buildSeries(
    scoped.rows,
    scoped.dateKeys,
    scoped.limitCnyMicros,
    input.view,
  )
  const actualRows = scoped.rows.filter(isActualUsageRow)
  return {
    schemaVersion: 1,
    view: input.view,
    range: input.range,
    timeZone: input.timeZone,
    coverage: {
      completeFrom: cutover.cutoverAt.toISOString(),
      includesManagedHistory: input.view === 'managed-cycle',
      byokHistoryMissing: true,
      attributionComplete: input.view === 'managed-cycle'
        || scoped.rangeStart.getTime() >= cutover.cutoverAt.getTime(),
    },
    summary: summarize(actualRows),
    series,
    breakdown: {
      funding: breakdown(actualRows, 'funding'),
      provider: breakdown(actualRows, 'provider'),
      capability: breakdown(actualRows, 'capability'),
      operation: breakdown(actualRows, 'operation'),
    },
    usageUnavailableCount: actualRows.filter(
      (row) => row.usageStatus === 'unavailable',
    ).length,
  }
}

async function accountRows(
  userId: string,
  range: AiUsageRange,
  timeZone: string,
) {
  const days = range === '30d' ? 30 : 7
  const database = await getDb()
  const dateKeys = recentDateKeys(days, timeZone)
  const rangeStart = zonedStart(dateKeys[0]!, timeZone)
  const rows = await database.select(selection(timeZone))
    .from(aiInvocations)
    .where(and(
      eq(aiInvocations.actorUserId, userId),
      isNotNull(aiInvocations.providerStartedAt),
      gte(aiInvocations.providerStartedAt, rangeStart),
    ))
    .orderBy(asc(aiInvocations.providerStartedAt))
  return {
    rows: rows as UsageRow[],
    dateKeys,
    rangeStart,
    limitCnyMicros: null,
  }
}

async function managedCycleRows(timeZone: string) {
  const database = await getDb()
  const workspaceId = currentWorkspaceId()
  const now = new Date()
  const [period] = await database.select({
    id: usagePeriods.id,
    startsAt: usagePeriods.startsAt,
    endsAt: usagePeriods.endsAt,
    limitCnyMicros: usagePeriods.limitCnyMicros,
  }).from(usagePeriods).where(and(
    eq(usagePeriods.workspaceId, workspaceId),
    lte(usagePeriods.startsAt, now),
    gt(usagePeriods.endsAt, now),
  )).orderBy(desc(usagePeriods.startsAt)).limit(1)
  if (!period) throw new Error('current usage period is missing')
  const rows = await database.select(selection(timeZone))
    .from(aiInvocations)
    .where(and(
      eq(aiInvocations.workspaceId, workspaceId),
      eq(aiInvocations.usagePeriodId, period.id),
      eq(aiInvocations.funding, 'managed'),
    ))
    .orderBy(asc(aiInvocations.settledAt))
  return {
    rows: rows as UsageRow[],
    dateKeys: dateKeysBetween(period.startsAt, period.endsAt, timeZone),
    rangeStart: period.startsAt,
    limitCnyMicros: period.limitCnyMicros,
  }
}

function selection(timeZone: string) {
  return {
    status: aiInvocations.status,
    provider: aiInvocations.provider,
    funding: aiInvocations.funding,
    capability: aiInvocations.capability,
    operation: aiInvocations.operation,
    usage: aiInvocations.usage,
    usageStatus: aiInvocations.usageStatus,
    startedAt: aiInvocations.providerStartedAt,
    durationMs: aiInvocations.providerDurationMs,
    localDate: sql<string>`to_char(
      timezone(${timeZone}, coalesce(
        ${aiInvocations.providerStartedAt},
        ${aiInvocations.settledAt}
      )),
      'YYYY-MM-DD'
    )`,
    settledCnyMicros: aiInvocations.settledCnyMicros,
  }
}
