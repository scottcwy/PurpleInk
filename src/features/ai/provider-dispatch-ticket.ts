import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db/client'
import {
  providerDispatchCooldowns,
  providerDispatches,
} from '@/lib/db/schema'
import { databaseNow } from './workspace-concurrency-context'
import { ProviderQueueDeferral } from './provider-queue-deferral'
import type { ProviderDispatchInput } from './provider-dispatch'

const DEFAULT_LEASE_MS = 5 * 60_000
const MAX_INLINE_WAIT_MS = 2_000

export async function activateProviderTicket(
  database: Db,
  context: {
    id: string
    input: ProviderDispatchInput
    scopeKey: string
  },
): Promise<void> {
  for (;;) {
    const remainingMs = await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${context.scopeKey}, 0))`,
      )
      const now = await databaseNow(transaction)
      const [ticket] = await transaction
        .select({
          status: providerDispatches.status,
          notBefore: providerDispatches.notBefore,
        })
        .from(providerDispatches)
        .where(and(
          eq(providerDispatches.id, context.id),
          eq(providerDispatches.scopeKey, context.scopeKey),
        ))
        .limit(1)
        .for('update')
      if (!ticket || ticket.status !== 'scheduled') {
        throw new Error('Provider 调度票据在激活前已失效')
      }
      const [cooldown] = await transaction
        .select({ blockedUntil: providerDispatchCooldowns.blockedUntil })
        .from(providerDispatchCooldowns)
        .where(eq(providerDispatchCooldowns.scopeKey, context.scopeKey))
        .limit(1)
      if (cooldown && cooldown.blockedUntil.getTime() > now.getTime()) {
        await transaction
          .update(providerDispatches)
          .set({ status: 'cancelled', releasedAt: sql`now()` })
          .where(eq(providerDispatches.id, context.id))
        console.info('[provider_ticket_cancelled]', {
          provider: context.input.providerId,
          attemptId: context.input.attemptId ?? null,
          ticketId: context.id,
          reason: 'cooldown',
        })
        throw new ProviderQueueDeferral({
          providerId: context.input.providerId,
          providerLabel: context.input.providerLabel,
          scopeKey: context.scopeKey,
          retryAt: cooldown.blockedUntil,
          waitReason: 'cooldown',
        })
      }
      const waitMs = ticket.notBefore.getTime() - now.getTime()
      if (waitMs > 0) return waitMs
      await transaction
        .update(providerDispatches)
        .set({
          status: 'in_flight',
          startedAt: sql`now()`,
          leaseExpiresAt: sql`now() + make_interval(secs => ${DEFAULT_LEASE_MS / 1_000})`,
        })
        .where(and(
          eq(providerDispatches.id, context.id),
          eq(providerDispatches.status, 'scheduled'),
        ))
      return 0
    })
    if (remainingMs <= 0) {
      console.info('[provider_ticket_activated]', {
        provider: context.input.providerId,
        attemptId: context.input.attemptId ?? null,
        ticketId: context.id,
      })
      return
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(1, Math.min(remainingMs, MAX_INLINE_WAIT_MS))))
  }
}

export async function reconcileExpiredProviderTickets(
  database?: Db,
): Promise<number> {
  const resolvedDatabase = database ?? await getDb()
  const rows = await resolvedDatabase
    .update(providerDispatches)
    .set({ status: 'cancelled', releasedAt: sql`now()` })
    .where(and(
      sql`${providerDispatches.status} in ('scheduled', 'in_flight')`,
      sql`(
        ${providerDispatches.leaseExpiresAt} <= now()
        or (
          ${providerDispatches.attemptId} is not null
          and exists (
            select 1
            from task_attempts parent_attempt
            where parent_attempt.workspace_id = ${providerDispatches.workspaceId}
              and parent_attempt.id = ${providerDispatches.attemptId}
              and parent_attempt.status <> 'running'
          )
        )
      )`,
    ))
    .returning({ id: providerDispatches.id })
  if (rows.length > 0) {
    console.info('[provider_ticket_reconciled]', { count: rows.length })
  }
  return rows.length
}
