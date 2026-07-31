import type { Db } from '@/lib/db/client'
import { storage } from '@/lib/storage'
import { sweepExpiredLeases } from './lease'

export interface QueueMaintenanceDependencies {
  sweepAttempts(database: Db): Promise<unknown>
  reconcileExecutions(database: Db): Promise<unknown>
  reconcileFrontiers(database: Db): Promise<unknown>
  reconcileProviderTickets(database: Db): Promise<unknown>
  cleanupStorage(database: Db): Promise<unknown>
}

type QueueMaintenanceLabel =
  | 'attempt_lease_sweep'
  | 'execution_epoch_reconcile'
  | 'director_frontier_reconcile'
  | 'provider_ticket_reconcile'
  | 'storage_cleanup_drain'

const defaultDependencies: QueueMaintenanceDependencies = {
  sweepAttempts: sweepExpiredLeases,
  reconcileExecutions: async (database) => {
    const { reconcileStaleExecutionEpochs } = await import(
      './execution-reconciliation'
    )
    return reconcileStaleExecutionEpochs(database)
  },
  reconcileFrontiers: async (database) => {
    const { reconcileDirectorFrontiers } = await import(
      '@/features/director/frontier-reconciliation'
    )
    return reconcileDirectorFrontiers(database)
  },
  reconcileProviderTickets: async (database) => {
    const { reconcileExpiredProviderTickets } = await import(
      '@/features/ai/provider-dispatch-ticket'
    )
    return reconcileExpiredProviderTickets(database)
  },
  cleanupStorage: async (database) => {
    const { drainAllStorageCleanupRequests } = await import(
      '@/lib/storage/cleanup-outbox'
    )
    return drainAllStorageCleanupRequests(
      { limit: 25 },
      { database, storage },
    )
  },
}

/** 各维护职责独立失败；前序异常不能饿死后续 cleanup outbox。 */
export async function runQueueMaintenance(
  database: Db,
  dependencies: QueueMaintenanceDependencies = defaultDependencies,
): Promise<void> {
  await runStep(
    'attempt_lease_sweep',
    () => dependencies.sweepAttempts(database),
  )
  await runStep(
    'execution_epoch_reconcile',
    () => dependencies.reconcileExecutions(database),
  )
  await runStep(
    'director_frontier_reconcile',
    () => dependencies.reconcileFrontiers(database),
  )
  await runStep(
    'provider_ticket_reconcile',
    () => dependencies.reconcileProviderTickets(database),
  )
  await runStep(
    'storage_cleanup_drain',
    () => dependencies.cleanupStorage(database),
  )
}

async function runStep(
  label: QueueMaintenanceLabel,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    console.error('[queue_maintenance_failed]', {
      label,
      code: 'QUEUE_MAINTENANCE_STEP_FAILED',
      errorName: safeErrorName(error),
    })
  }
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'NonErrorThrown'
  if (error instanceof AggregateError) return 'AggregateError'
  if (error instanceof TypeError) return 'TypeError'
  if (error instanceof RangeError) return 'RangeError'
  if (error instanceof ReferenceError) return 'ReferenceError'
  if (error instanceof SyntaxError) return 'SyntaxError'
  return 'Error'
}
