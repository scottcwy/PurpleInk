export interface ProviderLimits {
  concurrency: number
  rpm: number
  tpm?: number
  minIntervalMs?: number
  jitterMs?: number
  maxConcurrency?: number
}

export interface ProviderPoolPolicy {
  contractRpm: number
  softRpm: number
  hardRpm: number
  minIntervalMs: number
  jitterMs: number
  initialConcurrency: number
  maxConcurrency: number
}

const MANAGED_PROVIDER_POLICIES: Record<string, ProviderPoolPolicy> = {
  gemini: managedPolicy(1_000, 750, 900, 80, 8),
  stepfun: managedPolicy(200, 150, 180, 400, 40),
  mimo: managedPolicy(100, 75, 90, 800, 80),
}

export function providerPoolPolicy(providerId: string): ProviderPoolPolicy {
  return MANAGED_PROVIDER_POLICIES[providerId]
    ?? managedPolicy(60, 45, 54, 1_334, 134, 4, 20)
}

export function providerLimits(providerId: string): ProviderLimits {
  const prefix = providerId.replaceAll('-', '_').toUpperCase()
  const policy = providerPoolPolicy(providerId)
  return {
    concurrency: positiveInteger(process.env[`${prefix}_CONCURRENCY_LIMIT`])
      ?? policy.initialConcurrency,
    maxConcurrency: policy.maxConcurrency,
    rpm: positiveInteger(process.env[`${prefix}_RPM_LIMIT`]) ?? policy.hardRpm,
    minIntervalMs: policy.minIntervalMs,
    jitterMs: policy.jitterMs,
    ...(positiveInteger(process.env[`${prefix}_TPM_LIMIT`]) !== undefined
      ? { tpm: positiveInteger(process.env[`${prefix}_TPM_LIMIT`]) }
      : {}),
  }
}

export function byokProviderLimits(): ProviderLimits {
  return {
    concurrency: 50,
    maxConcurrency: 50,
    rpm: 1_000_000,
    minIntervalMs: 0,
    jitterMs: 0,
  }
}

function managedPolicy(
  contractRpm: number,
  softRpm: number,
  hardRpm: number,
  minIntervalMs: number,
  jitterMs: number,
  initialConcurrency = 8,
  maxConcurrency = 50,
): ProviderPoolPolicy {
  return {
    contractRpm,
    softRpm,
    hardRpm,
    minIntervalMs,
    jitterMs,
    initialConcurrency,
    maxConcurrency,
  }
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}
