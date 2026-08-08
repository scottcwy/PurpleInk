import { describe, expect, it } from 'vitest'

import { getConfigSummary, readCliConfig } from './config'

describe('readCliConfig', () => {
  it('reads generic OpenAI-compatible settings without exposing the key', () => {
    const config = readCliConfig({
      SCRIPT_VIDEO_AI_BASE_URL: 'https://api.example.test/v1',
      SCRIPT_VIDEO_AI_API_KEY: 'secret-key-that-must-not-leak',
      SCRIPT_VIDEO_AI_MODEL: 'demo-model',
      SCRIPT_VIDEO_CONCURRENCY: '6',
    }, 'C:/workspace')

    expect(config.provider).toBe('openai-compatible')
    expect(config.concurrency).toBe(6)
    expect(getConfigSummary(config)).toEqual(expect.objectContaining({
      provider: 'openai-compatible',
      aiConfigured: true,
      textModel: 'demo-model',
    }))
    expect(JSON.stringify(getConfigSummary(config))).not.toContain('secret-key')
  })

  it('supports an explicit fixture provider and bounded concurrency', () => {
    const config = readCliConfig({ SCRIPT_VIDEO_PROVIDER: 'fixture', SCRIPT_VIDEO_CONCURRENCY: '99' }, 'C:/workspace')

    expect(config.provider).toBe('fixture')
    expect(config.concurrency).toBe(32)
    expect(getConfigSummary(config).aiConfigured).toBe(true)
  })
})
