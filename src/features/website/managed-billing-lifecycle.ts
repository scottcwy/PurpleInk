import type {
  releaseManagedReservation,
  settleManagedInvocation,
} from '@/features/billing'

interface WebsiteBillingLifecycleDependencies {
  settleManagedInvocation: typeof settleManagedInvocation
  releaseManagedReservation: typeof releaseManagedReservation
  monotonicNow: () => number
}

export async function settleWebsiteUsageUnavailable(
  input: {
    workspaceId?: string
    invocationId: string
    maximumCostCnyMicros: bigint
    startedAt: number
    failed: boolean
    failureKind?: string
    originalError?: unknown
  },
  dependencies: WebsiteBillingLifecycleDependencies,
): Promise<void> {
  try {
    await dependencies.settleManagedInvocation({
      ...websiteBillingScope(input.workspaceId, input.invocationId),
      actualCostCnyMicros: input.maximumCostCnyMicros,
      usageStatus: 'unavailable',
      invocationStatus: input.failed ? 'failed' : 'succeeded',
      usage: {
        schemaVersion: 2,
        capability: 'workflow',
        unavailable: true,
      },
      providerDurationMs: elapsedMs(input.startedAt, dependencies.monotonicNow),
      ...(input.failureKind ? { failureKind: input.failureKind } : {}),
    })
  } catch (settlementError) {
    if (input.originalError) {
      throw new AggregateError(
        [input.originalError, settlementError],
        '网站视频执行与计费结算均失败',
      )
    }
    throw settlementError
  }
}

export async function releaseWebsiteReservation(
  input: {
    workspaceId?: string
    invocationId: string
    originalError: unknown
  },
  dependencies: WebsiteBillingLifecycleDependencies,
): Promise<void> {
  try {
    await dependencies.releaseManagedReservation(websiteBillingScope(
      input.workspaceId,
      input.invocationId,
    ))
  } catch (releaseError) {
    throw new AggregateError(
      [input.originalError, releaseError],
      '网站视频出网前失败且计费预留释放失败',
    )
  }
}

export function websiteBillingScope(
  workspaceId: string | undefined,
  invocationId: string,
) {
  return {
    ...(workspaceId ? { workspaceId } : {}),
    invocationId,
  }
}

function elapsedMs(startedAt: number, monotonicNow: () => number): number {
  return Math.max(0, Math.round(monotonicNow() - startedAt))
}
