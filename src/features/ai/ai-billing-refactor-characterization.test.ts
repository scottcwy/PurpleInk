import { describe, expect, it, vi } from 'vitest'
import {
  calculateActualCost,
  type RateCardPrice,
} from '@/features/billing/rate-card'
import {
  authorizeManagedRoute,
  type ManagedModelCatalogRepository,
} from './managed-service'
import { providerSettingsSchema } from './schemas'

vi.mock('server-only', () => ({}))

const catalog: ManagedModelCatalogRepository = {
  find: vi.fn(async ({ provider, modelId, capability }) => ({
    id: `${provider}:${modelId}:${capability}`,
    provider: provider as 'stepfun' | 'mimo' | 'gemini',
    modelId,
    capabilities: [capability],
    minimumPlanKey: 'free' as const,
    enabled: true,
  })),
  listEnabled: vi.fn(async () => []),
}

describe('AI and billing refactor characterization', () => {
  it('preserves every existing settings-page workload selection key', () => {
    const routes = {
      'script-import': 'gemini',
      'shot-split': 'stepfun',
      score: 'mimo',
      export: 'openai-compatible',
      'shot-script': 'gemini',
      'shot-codegen': 'stepfun',
      'shot-sfx': 'openai-compatible-tts',
      'shot-subtitle': 'openai-compatible-asr',
      'shot-qa': 'mimo',
    } as const

    expect(providerSettingsSchema.parse({ routes }).routes).toEqual(routes)
  })

  it('keeps managed and BYOK authorization financially disjoint', async () => {
    await expect(authorizeManagedRoute({
      plan: 'free',
      provider: 'stepfun',
      modelId: 'step-3.5-flash',
      capability: 'text',
      funding: 'managed',
    }, catalog)).resolves.toMatchObject({
      funding: 'managed',
      deductsManagedPool: true,
    })

    await expect(authorizeManagedRoute({
      plan: 'free',
      provider: 'stepfun',
      modelId: 'step-3.5-flash',
      capability: 'text',
      funding: 'byok',
    }, catalog)).resolves.toMatchObject({
      funding: 'byok',
      deductsManagedPool: false,
    })
  })

  it('keeps cached input, uncached input, and output as separate billing units', () => {
    const prices: RateCardPrice[] = [
      {
        unitKind: 'input_token',
        unitSize: BigInt(1_000_000),
        unitPriceCnyMicros: BigInt(1_000_000),
      },
      {
        unitKind: 'cached_input_token',
        unitSize: BigInt(1_000_000),
        unitPriceCnyMicros: BigInt(200_000),
      },
      {
        unitKind: 'output_token',
        unitSize: BigInt(1_000_000),
        unitPriceCnyMicros: BigInt(2_000_000),
      },
    ]

    expect(calculateActualCost(prices, {
      kind: 'text',
      inputTokens: 1,
      cachedInputTokens: 1,
      outputTokens: 1,
    })).toBe(BigInt(4))
  })
})
