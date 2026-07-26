import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDER_IDS,
  assertProviderCapability,
  providerSupports,
  providersFor,
} from './provider-registry'

describe('provider capability registry', () => {
  it('keeps exactly four stable provider identities', () => {
    expect(AI_PROVIDER_IDS).toEqual([
      'gemini',
      'stepfun',
      'mimo',
      'openai-compatible',
    ])
  })

  it('filters providers by real runtime capability', () => {
    expect(providerSupports('mimo', 'tts')).toBe(true)
    expect(providerSupports('gemini', 'tts')).toBe(false)
    expect(providersFor('asr')).toEqual(['stepfun', 'mimo'])
    expect(providersFor('vision')).toEqual([
      'gemini',
      'stepfun',
      'mimo',
      'openai-compatible',
    ])
  })

  it('rejects unsupported route assignments at the shared boundary', () => {
    expect(() =>
      assertProviderCapability('openai-compatible', 'tts')
    ).toThrow('不支持 TTS')
  })
})
