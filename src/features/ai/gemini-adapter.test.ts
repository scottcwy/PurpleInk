import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiAdapter, validateGeminiKey } from './gemini-adapter'

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Gemini 完成' } }],
  }),
  constructor: vi.fn(),
  getConfig: vi.fn(),
  resolveBaseUrl: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('./gemini-config', () => ({
  getGeminiConfig: mocks.getConfig,
  resolveGeminiBaseUrl: mocks.resolveBaseUrl,
}))
vi.mock('openai', () => ({
  default: class MockOpenAI {
    static readonly APIError = class extends Error {}
    readonly chat = { completions: { create: mocks.create } }
    constructor(options: unknown) {
      mocks.constructor(options)
    }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveBaseUrl.mockReturnValue(
    'https://generativelanguage.googleapis.com/v1beta/openai/',
  )
  mocks.getConfig.mockResolvedValue({
    apiKey: null,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    primaryModel: 'gemini-3.6-flash',
    fastModel: 'gemini-3.1-flash-lite',
  })
})

describe('GeminiAdapter', () => {
  it('uses Google official OpenAI-compatible configuration', async () => {
    const adapter = new GeminiAdapter('test-key')
    await adapter.chat([{ role: 'user', content: 'hello' }], {
      temperature: 0.9,
    })

    expect(mocks.constructor).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    })
    expect(mocks.create).toHaveBeenCalledWith({
      model: 'gemini-3.6-flash',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: undefined,
    })
  })

  it('validates with the candidate endpoint/model and never logs key material', async () => {
    await expect(
      validateGeminiKey('secret-key', {
        baseUrl: 'https://candidate.example/openai/',
        primaryModel: 'candidate-model',
      }),
    ).resolves.toBe(true)
    expect(mocks.constructor).toHaveBeenCalledWith({
      apiKey: 'secret-key',
      baseURL: 'https://candidate.example/openai/',
    })
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'candidate-model',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      expect.anything(),
    )

    mocks.create.mockRejectedValueOnce(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(validateGeminiKey('do-not-log')).resolves.toBe(false)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('do-not-log')
    errorSpy.mockRestore()
  })
})
