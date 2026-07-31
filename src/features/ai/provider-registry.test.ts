import { describe, expect, it } from 'vitest'
import { RouteContractError } from './route-contract-error'
import {
  AI_PROVIDER_IDS,
  PROVIDER_REGISTRY,
  assertProviderCapability,
  defaultModelFor,
  providerSupports,
  providersFor,
} from './provider-registry'

describe('provider capability registry', () => {
  it('preserves custom identities while adding OpenAI and Anthropic', () => {
    expect(AI_PROVIDER_IDS).toEqual([
      'gemini',
      'stepfun',
      'mimo',
      'openai',
      'anthropic',
      'openai-compatible',
      'openai-compatible-tts',
      'openai-compatible-asr',
    ])
  })

  it('filters providers by real runtime capability', () => {
    expect(providerSupports('mimo', 'tts')).toBe(true)
    expect(providerSupports('gemini', 'tts')).toBe(false)
    expect(providersFor('asr')).toEqual([
      'stepfun',
      'mimo',
      'openai-compatible-asr',
    ])
    expect(providersFor('tts')).toEqual([
      'stepfun',
      'mimo',
      'openai-compatible-tts',
    ])
    expect(providersFor('vision')).toEqual([
      'gemini',
      'stepfun',
      'mimo',
      'openai',
      'anthropic',
      'openai-compatible',
    ])
  })

  it('uses the catalog model defaults for all five built-in vendors', () => {
    expect(defaultModelFor('stepfun', 'text')).toBe('step-3.7-flash')
    expect(defaultModelFor('gemini', 'text')).toBe('gemini-3.6-flash')
    expect(defaultModelFor('openai', 'vision')).toBe('gpt-5.6-luna')
    expect(defaultModelFor('anthropic', 'text')).toBe('claude-sonnet-5')
  })

  it('rejects unsupported route assignments at the shared boundary', () => {
    expect(() =>
      assertProviderCapability('openai-compatible', 'tts')
    ).toThrow(RouteContractError)
    expect(() =>
      assertProviderCapability('openai-compatible', 'tts')
    ).toThrow('不支持 TTS')
  })

  /**
   * 三个自定义端点是三份独立凭据与配置，能力必须严格单向：TTS 端点不能承担 ASR，
   * 文本端点不能承担任何音频能力。否则设置页会允许把一条媒体路由指到一个从未针对
   * 该能力校验过的端点。
   */
  it('keeps the three custom endpoints capability-disjoint', () => {
    expect(providerSupports('openai-compatible-tts', 'tts')).toBe(true)
    expect(providerSupports('openai-compatible-tts', 'asr')).toBe(false)
    expect(providerSupports('openai-compatible-tts', 'text')).toBe(false)
    expect(providerSupports('openai-compatible-asr', 'asr')).toBe(true)
    expect(providerSupports('openai-compatible-asr', 'tts')).toBe(false)
    expect(providerSupports('openai-compatible', 'text')).toBe(true)
    expect(providerSupports('openai-compatible', 'asr')).toBe(false)

    expect(() =>
      assertProviderCapability('openai-compatible-tts', 'asr')
    ).toThrow('不支持 ASR')
    expect(() =>
      assertProviderCapability('openai-compatible-asr', 'text')
    ).toThrow('不支持 TEXT')
  })

  /**
   * 自定义端点没有内置默认模型：模型由用户 profile 提供，不能让 registry 顶一个
   * 编造的模型名出来。
   */
  it('refuses to invent default models for custom endpoints', () => {
    for (const provider of [
      'openai-compatible',
      'openai-compatible-tts',
      'openai-compatible-asr',
    ] as const) {
      expect(PROVIDER_REGISTRY[provider].defaultModels).toEqual({})
    }
  })
})
