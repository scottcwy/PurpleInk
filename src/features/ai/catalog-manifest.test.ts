import { describe, expect, it } from 'vitest'
import { PLAN_KEYS } from '@/features/billing/domain'
import {
  AI_BILLING_MANIFEST,
  BUILT_IN_PROVIDER_IDS,
} from '@/lib/config/generated/ai-billing-manifest'

describe('generated AI and billing manifest', () => {
  it('defines the five built-in vendors without embedding credentials', () => {
    expect(BUILT_IN_PROVIDER_IDS).toEqual([
      'stepfun',
      'mimo',
      'gemini',
      'openai',
      'anthropic',
    ])
    expect(JSON.stringify(AI_BILLING_MANIFEST)).not.toMatch(/sk-[a-z0-9]/i)
    expect(
      AI_BILLING_MANIFEST.deployments
        .filter((deployment) => deployment.funding === 'managed')
        .every((deployment) => deployment.secretRef.length > 0),
    ).toBe(true)
  })

  it('locks the requested model and channel identities', () => {
    expect(AI_BILLING_MANIFEST.deployments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'stepfun.step-3.7-flash.managed',
        outboundModelId: 'step-3.7-flash',
        officialPriceIdentity: 'stepfun.step-3.7-flash',
        baseUrl: 'https://api.stepfun.com/step_plan/v1',
      }),
      expect.objectContaining({
        id: 'gemini.3.6-flash.managed',
        outboundModelId: 'gemini-3.6-flash-tiered',
        officialPriceIdentity: 'google.gemini-3.6-flash',
        fallbackDeploymentId: 'gemini.3.1-flash-lite.managed',
      }),
      expect.objectContaining({
        id: 'openai.gpt-5.6-luna.managed',
        outboundModelId: 'openai/gpt-5.6-luna',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
      expect.objectContaining({
        id: 'anthropic.claude-sonnet-5.managed',
        outboundModelId: 'claude-sonnet-5',
        baseUrl: 'https://api.xhuoai.com/v1',
        adapter: 'openai-completions',
      }),
      expect.objectContaining({
        id: 'anthropic.claude-sonnet-5.byok',
        baseUrl: 'https://api.anthropic.com/v1',
        adapter: 'anthropic-messages',
      }),
    ]))
  })

  it('versions plan access and the updated concurrency limits', () => {
    expect(AI_BILLING_MANIFEST.catalogVersions).toEqual({
      ai: '2026-07-31.1',
      billing: '2026-07-31.1',
      plans: '2026-07-31.1',
    })
    expect(Object.keys(AI_BILLING_MANIFEST.plans)).toEqual([...PLAN_KEYS])
    expect(AI_BILLING_MANIFEST.plans.free).toMatchObject({
      concurrency: 3,
      managedProviders: ['stepfun', 'mimo'],
    })
    expect(AI_BILLING_MANIFEST.plans.plus).toMatchObject({
      concurrency: 20,
      managedProviders: ['stepfun', 'mimo', 'gemini'],
    })
    expect(AI_BILLING_MANIFEST.plans.pro).toMatchObject({
      concurrency: 50,
      managedProviders: BUILT_IN_PROVIDER_IDS,
    })
    expect(AI_BILLING_MANIFEST.plans.max).toMatchObject({
      concurrency: 100,
      managedProviders: BUILT_IN_PROVIDER_IDS,
    })
  })

  it('stores official list prices separately from channel execution data', () => {
    const price = (identity: string) =>
      AI_BILLING_MANIFEST.rateCards.find((card) =>
        card.id === identity || card.officialPriceIdentity === identity)

    expect(price('stepfun.step-3.7-flash')).toMatchObject({
      currency: 'CNY',
      prices: {
        inputToken: { unitSize: 1_000_000, sourcePriceMicros: 1_350_000 },
        cachedInputToken: { unitSize: 1_000_000, sourcePriceMicros: 270_000 },
        outputToken: { unitSize: 1_000_000, sourcePriceMicros: 8_100_000 },
      },
    })
    expect(price('openai.gpt-5.6-luna')).toMatchObject({
      currency: 'USD',
      prices: {
        inputToken: { unitSize: 1_000_000, sourcePriceMicros: 1_000_000 },
        cachedInputToken: { unitSize: 1_000_000, sourcePriceMicros: 100_000 },
        outputToken: { unitSize: 1_000_000, sourcePriceMicros: 6_000_000 },
      },
    })
    expect(price('anthropic.claude-sonnet-5.intro')).toMatchObject({
      effectiveTo: '2026-09-01T00:00:00.000Z',
      prices: {
        inputToken: { unitSize: 1_000_000, sourcePriceMicros: 2_000_000 },
        outputToken: { unitSize: 1_000_000, sourcePriceMicros: 10_000_000 },
      },
    })
    expect(price('anthropic.claude-sonnet-5.standard')).toMatchObject({
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      prices: {
        inputToken: { unitSize: 1_000_000, sourcePriceMicros: 3_000_000 },
        outputToken: { unitSize: 1_000_000, sourcePriceMicros: 15_000_000 },
      },
    })
  })
})
