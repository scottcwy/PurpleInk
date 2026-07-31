import { describe, expect, it } from 'vitest'
import {
  calculateActualCost,
  estimateMaximumCost,
  type RateCardPrice,
} from './rate-card'

const prices: RateCardPrice[] = [
  { unitKind: 'input_token', unitSize: BigInt(1_000_000), unitPriceCnyMicros: BigInt(2_000_000) },
  { unitKind: 'cached_input_token', unitSize: BigInt(1_000_000), unitPriceCnyMicros: BigInt(500_000) },
  { unitKind: 'cache_write_token', unitSize: BigInt(1_000_000), unitPriceCnyMicros: BigInt(1_250_000) },
  { unitKind: 'output_token', unitSize: BigInt(1_000_000), unitPriceCnyMicros: BigInt(8_000_000) },
  { unitKind: 'tts_character', unitSize: BigInt(1_000), unitPriceCnyMicros: BigInt(10) },
  { unitKind: 'audio_second', unitSize: BigInt(1), unitPriceCnyMicros: BigInt(100) },
]

describe('rate card calculation', () => {
  it('rounds each text unit upward and does not add reasoning twice', () => {
    expect(calculateActualCost(prices, {
      kind: 'text',
      inputTokens: 10,
      cachedInputTokens: 5,
      outputTokens: 4,
      reasoningTokens: 3,
    })).toBe(BigInt(55))
  })

  it('prices TTS characters and ASR duration using their own units', () => {
    expect(calculateActualCost(prices, { kind: 'tts', characters: 1001 })).toBe(BigInt(11))
    expect(calculateActualCost(prices, { kind: 'asr', audioSeconds: 3 })).toBe(BigInt(300))
    expect(calculateActualCost(prices, { kind: 'asr', audioSeconds: 3.001 })).toBe(BigInt(400))
  })

  it('prices cache writes separately and applies long-context ratios', () => {
    expect(calculateActualCost(prices, {
      kind: 'text',
      inputTokens: 272_001,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 10,
      outputTokens: 100_000,
    }, {
      tiers: [{
        inputTokensAbove: 272_000,
        inputNumerator: BigInt(2),
        inputDenominator: BigInt(1),
        outputNumerator: BigInt(3),
        outputDenominator: BigInt(2),
      }],
    })).toBe(BigInt(2_288_030))
  })

  it('prices website workflow output by whole video seconds', () => {
    const workflowPrices: RateCardPrice[] = [
      { unitKind: 'video_second', unitSize: BigInt(1), unitPriceCnyMicros: BigInt(125) },
    ]

    expect(calculateActualCost(workflowPrices, {
      kind: 'workflow',
      videoSeconds: 3.001,
    })).toBe(BigInt(500))
    expect(estimateMaximumCost(workflowPrices, {
      kind: 'workflow',
      videoSeconds: 12.2,
    })).toBe(BigInt(1_625))
  })

  it('rejects invalid website workflow duration instead of undercharging it', () => {
    const workflowPrices: RateCardPrice[] = [
      { unitKind: 'video_second', unitSize: BigInt(1), unitPriceCnyMicros: BigInt(125) },
    ]

    expect(() => calculateActualCost(workflowPrices, {
      kind: 'workflow',
      videoSeconds: Number.POSITIVE_INFINITY,
    })).toThrow('invalid video_second usage')
    expect(() => estimateMaximumCost(workflowPrices, {
      kind: 'workflow',
      videoSeconds: -1,
    })).toThrow('invalid video_second usage')
  })

  it('uses UTF-8 bytes as a conservative text input token bound', () => {
    expect(estimateMaximumCost(prices, {
      kind: 'text',
      input: '中文',
      maxOutputTokens: 2,
    })).toBe(BigInt(28))
  })
})
