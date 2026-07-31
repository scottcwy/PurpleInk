export type RateUnitKind =
  | 'input_token'
  | 'cached_input_token'
  | 'cache_write_token'
  | 'output_token'
  | 'tts_character'
  | 'audio_second'
  | 'video_second'

/**
 * 计费能力描述账本用量，不等同于 AI provider 的运行时能力注册表。
 * `workflow` 用于 PurpleInk 自有复合服务，不得据此开放模型路由。
 */
export type BillingCapability =
  | 'text'
  | 'vision'
  | 'tts'
  | 'asr'
  | 'workflow'

export interface RateCardPrice {
  unitKind: RateUnitKind
  unitSize: bigint
  unitPriceCnyMicros: bigint
}

export interface ContextPriceTier {
  inputTokensAbove: number
  inputNumerator: bigint
  inputDenominator: bigint
  outputNumerator: bigint
  outputDenominator: bigint
}

export interface RateCardPricingRules {
  tiers: ContextPriceTier[]
}

export type BillableUsage =
  | {
      kind: 'text' | 'vision'
      inputTokens: number
      cachedInputTokens?: number
      cacheWriteInputTokens?: number
      outputTokens: number
      reasoningTokens?: number
    }
  | { kind: 'tts'; characters: number }
  | { kind: 'asr'; audioSeconds: number }
  | { kind: 'workflow'; videoSeconds: number }

export type MaximumUsageEstimate =
  | { kind: 'text' | 'vision'; input: string | Uint8Array; maxOutputTokens: number }
  | { kind: 'tts'; characters: number }
  | { kind: 'asr'; audioSeconds: number }
  | { kind: 'workflow'; videoSeconds: number }

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) throw new Error('rate card unit size must be positive')
  return (numerator + denominator - BigInt(1)) / denominator
}

function price(
  prices: RateCardPrice[],
  unitKind: RateUnitKind,
  units: number,
): bigint {
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new Error(`invalid ${unitKind} usage`)
  }
  if (units === 0) return BigInt(0)
  const rate = prices.find((candidate) => candidate.unitKind === unitKind)
  if (!rate) throw new Error(`rate card is missing ${unitKind}`)
  return ceilDiv(BigInt(units) * rate.unitPriceCnyMicros, rate.unitSize)
}

export function calculateActualCost(
  prices: RateCardPrice[],
  usage: BillableUsage,
  rules?: RateCardPricingRules,
): bigint {
  if (usage.kind === 'tts') return price(prices, 'tts_character', usage.characters)
  if (usage.kind === 'asr') {
    return price(prices, 'audio_second', wholeSeconds(usage.audioSeconds, 'audio_second'))
  }
  if (usage.kind === 'workflow') {
    return price(prices, 'video_second', wholeVideoSeconds(usage.videoSeconds))
  }
  const inputCost = price(prices, 'input_token', usage.inputTokens)
    + price(prices, 'cached_input_token', usage.cachedInputTokens ?? 0)
    + price(prices, 'cache_write_token', usage.cacheWriteInputTokens ?? 0)
  const outputCost = price(prices, 'output_token', usage.outputTokens)
  return applyContextTier(
    inputCost,
    outputCost,
    usage.inputTokens
      + (usage.cachedInputTokens ?? 0)
      + (usage.cacheWriteInputTokens ?? 0),
    rules,
  )
}

export function estimateMaximumCost(
  prices: RateCardPrice[],
  estimate: MaximumUsageEstimate,
  rules?: RateCardPricingRules,
): bigint {
  if (estimate.kind === 'tts') {
    return price(prices, 'tts_character', estimate.characters)
  }
  if (estimate.kind === 'asr') {
    return price(prices, 'audio_second', wholeSeconds(estimate.audioSeconds, 'audio_second'))
  }
  if (estimate.kind === 'workflow') {
    return price(prices, 'video_second', wholeVideoSeconds(estimate.videoSeconds))
  }
  const inputBytes = typeof estimate.input === 'string'
    ? Buffer.byteLength(estimate.input, 'utf8')
    : estimate.input.byteLength
  return applyContextTier(
    price(prices, 'input_token', inputBytes),
    price(prices, 'output_token', estimate.maxOutputTokens),
    inputBytes,
    rules,
  )
}

function applyContextTier(
  inputCost: bigint,
  outputCost: bigint,
  inputTokens: number,
  rules?: RateCardPricingRules,
): bigint {
  const tier = rules?.tiers
    .filter((candidate) => inputTokens > candidate.inputTokensAbove)
    .sort((left, right) => right.inputTokensAbove - left.inputTokensAbove)[0]
  if (!tier) return inputCost + outputCost
  return multiplyRoundUp(
    inputCost,
    tier.inputNumerator,
    tier.inputDenominator,
  ) + multiplyRoundUp(
    outputCost,
    tier.outputNumerator,
    tier.outputDenominator,
  )
}

function multiplyRoundUp(
  amount: bigint,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) {
    throw new Error('invalid context price tier')
  }
  return ceilDiv(amount * numerator, denominator)
}

/** 视频时长按整秒计费；预留、结算与审计投影复用同一归一化。 */
export function wholeVideoSeconds(value: number): number {
  return wholeSeconds(value, 'video_second')
}

/** 媒体探针返回毫秒级小数；费率以整秒为原子并向上取整。 */
function wholeSeconds(
  value: number,
  unitKind: 'audio_second' | 'video_second',
): number {
  const seconds = Math.ceil(value)
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(seconds)) {
    throw new Error(`invalid ${unitKind} usage`)
  }
  return seconds
}
