import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)
const timestamp = z.string().datetime()
const capability = z.enum(['text', 'vision', 'tts', 'asr', 'workflow'])
const adapter = z.enum(['openai-completions', 'anthropic-messages'])
const funding = z.enum(['managed', 'byok'])

const providerSchema = z.object({
  id,
  label: z.string().min(1),
}).strict()

const channelSchema = z.object({
  id,
  providerId: id,
  funding,
  adapter,
  baseUrl: z.string().url(),
  secretRef: z.string().min(1),
  pool: z.object({
    maxInFlight: z.number().int().positive(),
    failureDomain: id,
  }).strict(),
}).strict()

const deploymentSchema = z.object({
  id,
  channelId: id,
  logicalModelId: z.string().min(1),
  outboundModelId: z.string().min(1),
  officialPriceIdentity: id,
  capabilities: z.array(capability).min(1),
  verifiedCapabilities: z.array(capability),
  fallbackDeploymentId: id.optional(),
}).strict()

export const aiCatalogSchema = z.object({
  version: z.literal(1),
  catalogVersion: z.string().min(1),
  providers: z.array(providerSchema).min(1),
  channels: z.array(channelSchema).min(1),
  deployments: z.array(deploymentSchema).min(1),
}).strict()

const priceUnit = z.object({
  unitSize: z.number().int().positive(),
  sourcePriceMicros: z.number().int().nonnegative(),
}).strict()

const prices = z.object({
  inputToken: priceUnit.optional(),
  cachedInputToken: priceUnit.optional(),
  cacheWriteToken: priceUnit.optional(),
  outputToken: priceUnit.optional(),
  ttsCharacter: priceUnit.optional(),
  audioSecond: priceUnit.optional(),
  videoSecond: priceUnit.optional(),
}).strict().refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  'rate card must contain at least one price',
)

const rateCardSchema = z.object({
  id,
  officialPriceIdentity: id,
  currency: z.enum(['CNY', 'USD']),
  fxRateId: id.optional(),
  effectiveFrom: timestamp,
  effectiveTo: timestamp.optional(),
  sourceUrl: z.string().min(1),
  retrievedAt: timestamp,
  promotional: z.boolean().optional(),
  prices,
  tiers: z.array(z.object({
    inputTokensAbove: z.number().int().nonnegative(),
    inputNumerator: z.number().int().positive(),
    inputDenominator: z.number().int().positive(),
    outputNumerator: z.number().int().positive(),
    outputDenominator: z.number().int().positive(),
  }).strict()).optional(),
}).strict()

export const billingCatalogSchema = z.object({
  version: z.literal(1),
  catalogVersion: z.string().min(1),
  fxRates: z.array(z.object({
    id,
    currency: z.literal('USD'),
    cnyMicrosPerCurrencyUnit: z.number().int().positive(),
    effectiveFrom: timestamp,
    sourceUrl: z.string().min(1),
    retrievedAt: timestamp,
  }).strict()),
  serviceMultipliers: z.array(z.object({
    id,
    capability,
    numerator: z.number().int().positive(),
    denominator: z.number().int().positive(),
  }).strict()),
  rateCards: z.array(rateCardSchema).min(1),
}).strict()

const planSchema = z.object({
  displayName: z.string().min(1),
  limitCnyMicros: z.number().int().nonnegative(),
  rank: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  managedProviders: z.array(id),
}).strict()

export const plansCatalogSchema = z.object({
  version: z.literal(1),
  catalogVersion: z.string().min(1),
  plans: z.object({
    free: planSchema,
    plus: planSchema,
    pro: planSchema,
    max: planSchema,
  }).strict(),
}).strict()

export type AiCatalogSource = z.infer<typeof aiCatalogSchema>
export type BillingCatalogSource = z.infer<typeof billingCatalogSchema>
export type PlansCatalogSource = z.infer<typeof plansCatalogSchema>

export function assertCatalogIntegrity(input: {
  ai: AiCatalogSource
  billing: BillingCatalogSource
  plans: PlansCatalogSource
}): void {
  assertUnique(input.ai.providers.map((item) => item.id), 'provider')
  assertUnique(input.ai.channels.map((item) => item.id), 'channel')
  assertUnique(input.ai.deployments.map((item) => item.id), 'deployment')
  assertUnique(input.billing.rateCards.map((item) => item.id), 'rate card')

  const providerIds = new Set(input.ai.providers.map((item) => item.id))
  const channels = new Map(input.ai.channels.map((item) => [item.id, item]))
  const deployments = new Map(input.ai.deployments.map((item) => [item.id, item]))
  const priceIdentities = new Set(
    input.billing.rateCards.map((item) => item.officialPriceIdentity),
  )
  const fxIds = new Set(input.billing.fxRates.map((item) => item.id))

  for (const channel of input.ai.channels) {
    assertReference(providerIds.has(channel.providerId), `channel ${channel.id} provider`)
    if (channel.funding === 'managed' && channel.secretRef === 'workspace-credential') {
      throw new Error(`managed channel ${channel.id} requires a platform secretRef`)
    }
  }
  for (const deployment of input.ai.deployments) {
    const channel = channels.get(deployment.channelId)
    assertReference(channel !== undefined, `deployment ${deployment.id} channel`)
    assertReference(
      deployment.verifiedCapabilities.every((item) =>
        deployment.capabilities.includes(item)),
      `deployment ${deployment.id} verified capability`,
    )
    assertReference(
      priceIdentities.has(deployment.officialPriceIdentity),
      `deployment ${deployment.id} official price`,
    )
    if (deployment.fallbackDeploymentId) {
      const fallback = deployments.get(deployment.fallbackDeploymentId)
      assertReference(fallback !== undefined, `deployment ${deployment.id} fallback`)
      if (channel?.funding !== 'managed') {
        throw new Error(`BYOK deployment ${deployment.id} cannot declare a fallback`)
      }
    }
  }
  for (const plan of Object.values(input.plans.plans)) {
    for (const provider of plan.managedProviders) {
      assertReference(providerIds.has(provider), `plan provider ${provider}`)
    }
  }
  for (const card of input.billing.rateCards) {
    if (card.currency === 'USD') {
      assertReference(
        card.fxRateId !== undefined && fxIds.has(card.fxRateId),
        `rate card ${card.id} FX`,
      )
    }
    if (
      card.effectiveTo !== undefined
      && Date.parse(card.effectiveTo) <= Date.parse(card.effectiveFrom)
    ) {
      throw new Error(`rate card ${card.id} has an invalid effective range`)
    }
  }
  assertNoRateOverlap(input.billing.rateCards)
  if (/sk-[a-z0-9]/i.test(JSON.stringify(input))) {
    throw new Error('catalog must not contain credential-like values')
  }
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} ids must be unique`)
  }
}

function assertReference(condition: boolean, label: string): void {
  if (!condition) throw new Error(`invalid catalog reference: ${label}`)
}

function assertNoRateOverlap(
  cards: BillingCatalogSource['rateCards'],
): void {
  const grouped = new Map<string, typeof cards>()
  for (const card of cards) {
    grouped.set(card.officialPriceIdentity, [
      ...(grouped.get(card.officialPriceIdentity) ?? []),
      card,
    ])
  }
  for (const [identity, entries] of grouped) {
    const ordered = [...entries].sort((left, right) =>
      Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom))
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]
      const current = ordered[index]
      if (!previous?.effectiveTo) {
        throw new Error(`rate cards overlap for ${identity}`)
      }
      const previousEnd = Date.parse(previous.effectiveTo)
      const currentStart = Date.parse(current!.effectiveFrom)
      if (previousEnd > currentStart) {
        throw new Error(`rate cards overlap for ${identity}`)
      }
      if (previousEnd < currentStart) {
        throw new Error(`rate cards have a gap for ${identity}`)
      }
    }
  }
}
