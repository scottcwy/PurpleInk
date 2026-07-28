export type RateUnitKind =
  | 'input_token'
  | 'cached_input_token'
  | 'output_token'
  | 'tts_character'
  | 'audio_second'

export interface RateCardPrice {
  unitKind: RateUnitKind
  unitSize: bigint
  unitPriceCnyMicros: bigint
}

export type BillableUsage =
  | {
      kind: 'text' | 'vision'
      inputTokens: number
      cachedInputTokens?: number
      outputTokens: number
      reasoningTokens?: number
    }
  | { kind: 'tts'; characters: number }
  | { kind: 'asr'; audioSeconds: number }

export type MaximumUsageEstimate =
  | { kind: 'text' | 'vision'; input: string | Uint8Array; maxOutputTokens: number }
  | { kind: 'tts'; characters: number }
  | { kind: 'asr'; audioSeconds: number }

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
): bigint {
  if (usage.kind === 'tts') return price(prices, 'tts_character', usage.characters)
  if (usage.kind === 'asr') return price(prices, 'audio_second', usage.audioSeconds)
  return price(prices, 'input_token', usage.inputTokens)
    + price(prices, 'cached_input_token', usage.cachedInputTokens ?? 0)
    + price(prices, 'output_token', usage.outputTokens)
}

export function estimateMaximumCost(
  prices: RateCardPrice[],
  estimate: MaximumUsageEstimate,
): bigint {
  if (estimate.kind === 'tts') {
    return price(prices, 'tts_character', estimate.characters)
  }
  if (estimate.kind === 'asr') {
    return price(prices, 'audio_second', Math.ceil(estimate.audioSeconds))
  }
  const inputBytes = typeof estimate.input === 'string'
    ? Buffer.byteLength(estimate.input, 'utf8')
    : estimate.input.byteLength
  return price(prices, 'input_token', inputBytes)
    + price(prices, 'output_token', estimate.maxOutputTokens)
}
