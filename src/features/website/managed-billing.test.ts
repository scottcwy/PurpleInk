import { describe, expect, it, vi } from 'vitest'
import {
  runManagedWebsiteBilling,
  type ManagedWebsiteBillingDependencies,
} from './managed-billing'

vi.mock('server-only', () => ({}))

const RATE_CARD = {
  id: '00000000-0000-4000-8000-000000000010',
  version: 1,
  priceCurrency: 'CNY' as const,
  fxCnyMicrosPerCurrencyUnit: BigInt(1_000_000),
  prices: [{
    unitKind: 'video_second' as const,
    unitSize: BigInt(1),
    unitPriceCnyMicros: BigInt(125),
  }],
}

const CONTEXT = {
  attemptId: '00000000-0000-4000-8000-000000000020',
  invocationNo: 3,
  requestIdentity: 'public-url-fingerprint',
  maximumDurationSeconds: 24,
}

function createDependencies(): ManagedWebsiteBillingDependencies {
  let monotonicMs = 100
  return {
    getCurrentRateCard: vi.fn(async () => RATE_CARD),
    estimateMaximumCost: vi.fn(() => BigInt(3_000)),
    reserveManagedInvocation: vi.fn(async () => ({
      periodId: '00000000-0000-4000-8000-000000000030',
      reservedCnyMicros: BigInt(3_000),
    })),
    markManagedInvocationStarted: vi.fn(async () => undefined),
    calculateActualCost: vi.fn(() => BigInt(1_000)),
    settleManagedInvocation: vi.fn(async () => undefined),
    releaseManagedReservation: vi.fn(async () => undefined),
    monotonicNow: vi.fn(() => {
      monotonicMs += 25
      return monotonicMs
    }),
  }
}

describe('website composite managed billing', () => {
  it('reserves from the shared managed pool and settles output-derived seconds', async () => {
    const dependencies = createDependencies()
    const invoke = vi.fn(async () => ({
      durationSec: 7.2,
      durationSource: 'output' as const,
      outputHash: 'a'.repeat(64),
    }))

    await expect(runManagedWebsiteBilling({
      ...CONTEXT,
      invoke,
      completion: (result) => result,
    }, dependencies)).resolves.toMatchObject({ durationSource: 'output' })

    expect(dependencies.getCurrentRateCard).toHaveBeenCalledWith({
      provider: 'purpleink-engine',
      model: 'website-video-v1',
      capability: 'workflow',
    })
    expect(dependencies.estimateMaximumCost).toHaveBeenCalledWith(
      RATE_CARD.prices,
      { kind: 'workflow', videoSeconds: 24 },
    )
    expect(dependencies.calculateActualCost).toHaveBeenCalledWith(
      RATE_CARD.prices,
      { kind: 'workflow', videoSeconds: 7.2 },
    )
    const reservation = vi.mocked(dependencies.reserveManagedInvocation).mock.calls[0]![0]
    expect(reservation).toMatchObject({
      rateCardId: RATE_CARD.id,
      maximumCostCnyMicros: BigInt(3_000),
      create: {
        attemptId: CONTEXT.attemptId,
        invocationNo: CONTEXT.invocationNo,
        provider: 'purpleink-engine',
        model: 'website-video-v1',
        capability: 'workflow',
        operation: 'website-video',
        source: 'products',
      },
    })
    expect(reservation.invocationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(reservation.idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
    expect(reservation.create?.inputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(dependencies.markManagedInvocationStarted).toHaveBeenCalledWith({
      invocationId: reservation.invocationId,
    })
    expect(dependencies.settleManagedInvocation).toHaveBeenCalledWith({
      invocationId: reservation.invocationId,
      actualCostCnyMicros: BigInt(1_000),
      invocationStatus: 'succeeded',
      outputHash: 'a'.repeat(64),
      providerDurationMs: 25,
      usage: {
        schemaVersion: 2,
        capability: 'workflow',
        kind: 'workflow',
        videoSeconds: 8,
      },
      usageStatus: 'reported',
    })
    expect(dependencies.releaseManagedReservation).not.toHaveBeenCalled()
  })

  it('uses maximum reservation when the worker reports only requested duration', async () => {
    const dependencies = createDependencies()

    await runManagedWebsiteBilling({
      ...CONTEXT,
      invoke: vi.fn(async () => ({ durationSec: 24, durationSource: 'request' as const })),
      completion: (result) => result,
    }, dependencies)

    const reservation = vi.mocked(dependencies.reserveManagedInvocation).mock.calls[0]![0]
    expect(dependencies.calculateActualCost).not.toHaveBeenCalled()
    expect(dependencies.settleManagedInvocation).toHaveBeenCalledWith({
      invocationId: reservation.invocationId,
      actualCostCnyMicros: BigInt(3_000),
      invocationStatus: 'succeeded',
      providerDurationMs: 25,
      usage: {
        schemaVersion: 2,
        capability: 'workflow',
        unavailable: true,
      },
      usageStatus: 'unavailable',
    })
  })

  it('settles worker failures as unavailable and preserves the original error internally', async () => {
    const dependencies = createDependencies()
    const upstreamError = new Error('worker internal detail')

    await expect(runManagedWebsiteBilling({
      ...CONTEXT,
      invoke: vi.fn(async () => {
        throw upstreamError
      }),
      completion: () => ({ durationSec: null, durationSource: null }),
    }, dependencies)).rejects.toBe(upstreamError)

    const reservation = vi.mocked(dependencies.reserveManagedInvocation).mock.calls[0]![0]
    expect(dependencies.settleManagedInvocation).toHaveBeenCalledWith({
      invocationId: reservation.invocationId,
      actualCostCnyMicros: BigInt(3_000),
      failureKind: 'website_engine_failed',
      invocationStatus: 'failed',
      providerDurationMs: 25,
      usage: {
        schemaVersion: 2,
        capability: 'workflow',
        unavailable: true,
      },
      usageStatus: 'unavailable',
    })
  })

  it('does not call the worker when shared quota reservation fails', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.reserveManagedInvocation).mockRejectedValue(
      new Error('quota unavailable'),
    )
    const invoke = vi.fn(async () => ({ durationSec: 10, durationSource: 'output' as const }))

    await expect(runManagedWebsiteBilling({
      ...CONTEXT,
      invoke,
      completion: (result) => result,
    }, dependencies)).rejects.toThrow('quota unavailable')

    expect(invoke).not.toHaveBeenCalled()
    expect(dependencies.markManagedInvocationStarted).not.toHaveBeenCalled()
    expect(dependencies.settleManagedInvocation).not.toHaveBeenCalled()
  })

  it('releases reservation if bookkeeping fails before the worker call', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.markManagedInvocationStarted).mockRejectedValue(
      new Error('start marker failed'),
    )
    const invoke = vi.fn(async () => ({ durationSec: 10, durationSource: 'output' as const }))

    await expect(runManagedWebsiteBilling({
      ...CONTEXT,
      invoke,
      completion: (result) => result,
    }, dependencies)).rejects.toThrow('start marker failed')

    const reservation = vi.mocked(dependencies.reserveManagedInvocation).mock.calls[0]![0]
    expect(invoke).not.toHaveBeenCalled()
    expect(dependencies.releaseManagedReservation).toHaveBeenCalledWith({
      invocationId: reservation.invocationId,
    })
  })
})
