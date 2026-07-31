import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  managedModelCatalog,
  rateCards,
  rateCardUnits,
} from '@/lib/db/schema/index'
import type {
  BillingCapability,
  RateCardPricingRules,
  RateCardPrice,
  RateUnitKind,
} from './rate-card'

export interface CurrentRateCard {
  id: string
  version: number
  priceCurrency: 'CNY' | 'USD'
  fxCnyMicrosPerCurrencyUnit: bigint
  prices: RateCardPrice[]
  pricingRules?: RateCardPricingRules
}

export async function getCurrentRateCard(input: {
  catalogId?: string
  provider: string
  model: string
  capability: BillingCapability
  now?: Date
}): Promise<CurrentRateCard> {
  const database = await getDb()
  const now = input.now ?? new Date()
  const [card] = await database.select({
    id: rateCards.id,
    version: rateCards.version,
    priceCurrency: rateCards.priceCurrency,
    fxCnyMicrosPerCurrencyUnit: rateCards.fxCnyMicrosPerCurrencyUnit,
    pricingRules: rateCards.pricingRules,
  }).from(rateCards)
    .innerJoin(
      managedModelCatalog,
      eq(rateCards.catalogId, managedModelCatalog.id),
    )
    .where(and(
      input.catalogId
        ? eq(managedModelCatalog.id, input.catalogId)
        : and(
            eq(managedModelCatalog.provider, input.provider),
            eq(managedModelCatalog.model, input.model),
            eq(managedModelCatalog.capability, input.capability),
          ),
      eq(managedModelCatalog.enabled, true),
      lte(rateCards.effectiveAt, now),
      or(isNull(rateCards.retiredAt), gt(rateCards.retiredAt, now)),
    ))
    .orderBy(desc(rateCards.version))
    .limit(1)
  if (!card) throw new Error('managed rate card is unavailable')
  const units = await database.select({
    unitKind: rateCardUnits.unitKind,
    unitSize: rateCardUnits.unitSize,
    unitPriceCnyMicros: rateCardUnits.unitPriceCnyMicros,
  }).from(rateCardUnits).where(eq(rateCardUnits.rateCardId, card.id))
  const { pricingRules, ...cardFields } = card
  return {
    ...cardFields,
    priceCurrency: card.priceCurrency as 'CNY' | 'USD',
    ...(pricingRules
      ? { pricingRules: deserializePricingRules(pricingRules) }
      : {}),
    prices: units.map((unit) => ({
      ...unit,
      unitKind: unit.unitKind as RateUnitKind,
    })),
  }
}

function deserializePricingRules(
  rules: NonNullable<typeof rateCards.$inferSelect.pricingRules>,
): RateCardPricingRules {
  return {
    tiers: rules.tiers.map((tier) => ({
      inputTokensAbove: tier.inputTokensAbove,
      inputNumerator: BigInt(tier.inputNumerator),
      inputDenominator: BigInt(tier.inputDenominator),
      outputNumerator: BigInt(tier.outputNumerator),
      outputDenominator: BigInt(tier.outputDenominator),
    })),
  }
}
