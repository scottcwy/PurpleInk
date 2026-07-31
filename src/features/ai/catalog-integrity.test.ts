import { describe, expect, it } from 'vitest'
import { loadCatalogSources } from '../../../scripts/generate/ai-billing-catalog'
import { assertCatalogIntegrity } from '../../../scripts/generate/ai-billing-catalog-schema'

describe('AI billing catalog integrity', () => {
  it('rejects an unexplained gap between consecutive official rate cards', async () => {
    const sources = await loadCatalogSources()
    const standard = sources.billing.rateCards.find((card) =>
      card.id === 'anthropic.claude-sonnet-5.standard')
    if (!standard) throw new Error('standard Claude rate card is missing')
    standard.effectiveFrom = '2026-09-02T00:00:00.000Z'

    expect(() => assertCatalogIntegrity(sources)).toThrow(
      'rate cards have a gap for anthropic.claude-sonnet-5',
    )
  })
})
