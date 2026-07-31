import { describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db/client'
import {
  runQueueMaintenance,
  type QueueMaintenanceDependencies,
} from './queue-maintenance'

vi.mock('server-only', () => ({}))

describe('queue maintenance isolation', () => {
  it('still drains storage cleanup when an earlier reconciliation fails', async () => {
    const dependencies = maintenanceDependencies()
    const failure = new Error(
      'postgres://admin:secret@example.test/db SELECT credential',
    )
    failure.name = 'DB_PASSWORD_SUPER_SECRET'
    failure.stack = 'sensitive query stack'
    vi.mocked(dependencies.sweepAttempts)
      .mockRejectedValueOnce(failure)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      runQueueMaintenance({} as Db, dependencies),
    ).resolves.toBeUndefined()

    expect(dependencies.cleanupStorage).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith(
      '[queue_maintenance_failed]',
      {
        label: 'attempt_lease_sweep',
        code: 'QUEUE_MAINTENANCE_STEP_FAILED',
        errorName: 'Error',
      },
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(error.mock.calls)).not.toContain('SELECT')
    expect(JSON.stringify(error.mock.calls)).not.toContain('stack')
    error.mockRestore()
  })
})

function maintenanceDependencies(): QueueMaintenanceDependencies {
  return {
    sweepAttempts: vi.fn(async () => undefined),
    reconcileExecutions: vi.fn(async () => undefined),
    reconcileFrontiers: vi.fn(async () => undefined),
    reconcileProviderTickets: vi.fn(async () => undefined),
    cleanupStorage: vi.fn(async () => undefined),
  }
}
