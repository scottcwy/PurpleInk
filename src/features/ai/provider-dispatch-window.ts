import type { ProviderDispatchWaitReason } from './provider-queue-deferral'
import type { ProviderLimits } from './provider-pool-policy'

export const PROVIDER_RATE_WINDOW_MS = 60_000

export function nextProviderWindow(input: {
  limits: ProviderLimits
  rpm: number
  tokens: number
  tokenEstimate: number
  oldest: Date | null
  newest: Date | null
  active: number
  nextLease: Date | null
  now: Date
}): { retryAt: Date; reason: ProviderDispatchWaitReason } | undefined {
  const candidates: Array<{
    retryAt: Date
    reason: ProviderDispatchWaitReason
  }> = []
  const jitter = () => Math.round(Math.random() * (input.limits.jitterMs ?? 0))
  if (input.newest && (input.limits.minIntervalMs ?? 0) > 0) {
    const retryAt = new Date(
      input.newest.getTime() + (input.limits.minIntervalMs ?? 0) + jitter(),
    )
    if (retryAt.getTime() > input.now.getTime()) {
      candidates.push({ retryAt, reason: 'pacing' })
    }
  }
  if (input.rpm >= input.limits.rpm && input.oldest) {
    candidates.push({
      retryAt: new Date(
        input.oldest.getTime() + PROVIDER_RATE_WINDOW_MS + jitter(),
      ),
      reason: 'rpm',
    })
  }
  if (
    input.limits.tpm !== undefined
    && input.tokens + input.tokenEstimate > input.limits.tpm
    && input.oldest
  ) {
    candidates.push({
      retryAt: new Date(
        input.oldest.getTime() + PROVIDER_RATE_WINDOW_MS + jitter(),
      ),
      reason: 'tpm',
    })
  }
  if (input.active >= input.limits.concurrency && input.nextLease) {
    candidates.push({
      retryAt: new Date(input.nextLease.getTime() + jitter()),
      reason: 'concurrency',
    })
  }
  const pending = candidates.filter(
    ({ retryAt }) => retryAt.getTime() > input.now.getTime(),
  )
  if (pending.length === 0) return undefined
  return pending.reduce((latest, candidate) =>
    candidate.retryAt.getTime() > latest.retryAt.getTime() ? candidate : latest
  )
}

export function providerRateLimitBackoffMs(failureCount: number): number {
  const sequence = [2_000, 4_000, 8_000, 16_000, 30_000]
  const index = Math.min(Math.max(failureCount, 0), sequence.length - 1)
  const base = sequence[index]!
  return base + Math.round(Math.random() * base * 0.2)
}
