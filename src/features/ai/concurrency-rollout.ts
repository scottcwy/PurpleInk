import 'server-only'

const DEFAULT_ENFORCEMENT_PERCENT = 100

export type ProviderPoolMode = 'shadow' | 'enforce'

interface ConcurrencyEnvironment {
  AI_PROVIDER_POOL_MODE?: string
  AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT?: string
}

export function providerPoolMode(
  environment: ConcurrencyEnvironment = currentEnvironment(),
): ProviderPoolMode {
  return environment.AI_PROVIDER_POOL_MODE === 'shadow' ? 'shadow' : 'enforce'
}

export function workspaceConcurrencyEnforced(
  workspaceId: string,
  environment: ConcurrencyEnvironment = currentEnvironment(),
): boolean {
  const percent = enforcementPercent(
    environment.AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT,
  )
  if (percent === 0) return false
  if (percent === 100) return true
  return stableBucket(workspaceId) < percent
}

export function enforcementPercent(rawValue: string | undefined): number {
  if (rawValue === undefined || !/^\d+$/.test(rawValue)) {
    return DEFAULT_ENFORCEMENT_PERCENT
  }
  const value = Number(rawValue)
  return value >= 0 && value <= 100 ? value : DEFAULT_ENFORCEMENT_PERCENT
}

function stableBucket(value: string): number {
  let hash = 2_166_136_261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % 100
}

function currentEnvironment(): ConcurrencyEnvironment {
  return {
    AI_PROVIDER_POOL_MODE: process.env.AI_PROVIDER_POOL_MODE,
    AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT:
      process.env.AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT,
  }
}
