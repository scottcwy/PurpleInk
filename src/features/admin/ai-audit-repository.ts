import 'server-only'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  aiInvocations,
  entitlementLedgerEntries,
  officialCostEntries,
} from '@/lib/db/schema'
import { normalizeAiAuditRow, type AdminAiAuditRow } from './operational-projections'

export interface AdminAiAuditSnapshot {
  days: number
  items: AdminAiAuditRow[]
}

export async function getAdminAiAudit(days = 7): Promise<AdminAiAuditSnapshot> {
  const boundedDays = Math.min(Math.max(Math.trunc(days), 1), 90)
  const db = await getDb()
  const rows = await db
    .select({
      logicalModelId: aiInvocations.logicalModelId,
      outboundModelId: aiInvocations.outboundModelId,
      deploymentId: aiInvocations.deploymentId,
      channelId: aiInvocations.channelId,
      funding: aiInvocations.funding,
      failureDomainId: aiInvocations.failureDomainId,
      status: aiInvocations.status,
      invocationCount: count(),
      officialCostCnyMicros: sql<string>`coalesce(sum(${officialCostEntries.cnyMicros}), 0)::text`,
      entitlementDebitCnyMicros: sql<string>`coalesce(sum(${entitlementLedgerEntries.debitCnyMicros}), 0)::text`,
      lastInvokedAt: sql<Date>`max(${aiInvocations.createdAt})`,
    })
    .from(aiInvocations)
    .leftJoin(
      officialCostEntries,
      and(
        eq(officialCostEntries.workspaceId, aiInvocations.workspaceId),
        eq(officialCostEntries.invocationId, aiInvocations.id),
      ),
    )
    .leftJoin(
      entitlementLedgerEntries,
      and(
        eq(entitlementLedgerEntries.workspaceId, aiInvocations.workspaceId),
        eq(entitlementLedgerEntries.invocationId, aiInvocations.id),
      ),
    )
    .where(and(
      eq(aiInvocations.telemetryVersion, 3),
      gte(aiInvocations.createdAt, sql`now() - (${boundedDays} * interval '1 day')`),
    ))
    .groupBy(
      aiInvocations.logicalModelId,
      aiInvocations.outboundModelId,
      aiInvocations.deploymentId,
      aiInvocations.channelId,
      aiInvocations.funding,
      aiInvocations.failureDomainId,
      aiInvocations.status,
    )
    .orderBy(desc(sql`max(${aiInvocations.createdAt})`))
    .limit(200)

  return { days: boundedDays, items: rows.map(normalizeAiAuditRow) }
}
