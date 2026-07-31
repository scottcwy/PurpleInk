import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  aiInvocations,
  entitlementLedgerEntries,
  usagePeriods,
} from '@/lib/db/schema'

export interface BillingShadowDifference {
  usagePeriodId: string
  periodUsedCnyMicros: bigint
  invocationSettledCnyMicros: bigint
  entitlementDebitCnyMicros: bigint
  periodDifferenceCnyMicros: bigint
  invocationDifferenceCnyMicros: bigint
  exact: boolean
}

export interface BillingShadowReport {
  workspaceId: string
  exact: boolean
  periods: BillingShadowDifference[]
}

export async function reconcileBillingShadow(
  workspaceId = currentWorkspaceId(),
): Promise<BillingShadowReport> {
  const database = await getDb()
  const [periods, invocationTotals, ledgerTotals] = await Promise.all([
    database.select({
      id: usagePeriods.id,
      usedCnyMicros: usagePeriods.usedCnyMicros,
    }).from(usagePeriods).where(eq(usagePeriods.workspaceId, workspaceId)),
    database.select({
      usagePeriodId: aiInvocations.usagePeriodId,
      total: sql<string>`coalesce(sum(${aiInvocations.settledCnyMicros}), 0)`,
    }).from(aiInvocations).where(and(
      eq(aiInvocations.workspaceId, workspaceId),
      eq(aiInvocations.funding, 'managed'),
      eq(aiInvocations.billingStatus, 'settled'),
    )).groupBy(aiInvocations.usagePeriodId),
    database.select({
      usagePeriodId: entitlementLedgerEntries.usagePeriodId,
      total: sql<string>`coalesce(sum(${entitlementLedgerEntries.debitCnyMicros}), 0)`,
    }).from(entitlementLedgerEntries).where(
      eq(entitlementLedgerEntries.workspaceId, workspaceId),
    ).groupBy(entitlementLedgerEntries.usagePeriodId),
  ])
  const invocationByPeriod = totalByPeriod(invocationTotals)
  const ledgerByPeriod = totalByPeriod(ledgerTotals)
  const differences = periods.map((period) => {
    const invocationSettledCnyMicros =
      invocationByPeriod.get(period.id) ?? BigInt(0)
    const entitlementDebitCnyMicros =
      ledgerByPeriod.get(period.id) ?? BigInt(0)
    const periodDifferenceCnyMicros =
      period.usedCnyMicros - entitlementDebitCnyMicros
    const invocationDifferenceCnyMicros =
      invocationSettledCnyMicros - entitlementDebitCnyMicros
    return {
      usagePeriodId: period.id,
      periodUsedCnyMicros: period.usedCnyMicros,
      invocationSettledCnyMicros,
      entitlementDebitCnyMicros,
      periodDifferenceCnyMicros,
      invocationDifferenceCnyMicros,
      exact: periodDifferenceCnyMicros === BigInt(0)
        && invocationDifferenceCnyMicros === BigInt(0),
    }
  })
  return {
    workspaceId,
    exact: differences.every((difference) => difference.exact),
    periods: differences,
  }
}

function totalByPeriod(
  rows: Array<{ usagePeriodId: string | null; total: string }>,
): Map<string, bigint> {
  return new Map(rows.flatMap((row) =>
    row.usagePeriodId ? [[row.usagePeriodId, BigInt(row.total)]] : []))
}
