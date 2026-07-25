import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateGeminiKey } from './gemini-adapter'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('./gemini-config', () => ({
  getGeminiConfig: mocks.getConfig,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getConfig.mockResolvedValue({
    apiKey: null,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    primaryModel: 'gemini-3.6-flash',
    fastModel: 'gemini-3.1-flash-lite',
  })
})

describe('validateGeminiKey', () => {
  it('joins the trailing-slash default baseUrl without double slashes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))

    await expect(validateGeminiKey('secret-key', {}, fetcher)).resolves.toBe(
      true,
    )

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    )
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer secret-key',
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gemini-3.6-flash',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('validates with the candidate endpoint/model and never logs key material', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))

    await expect(
      validateGeminiKey(
        'secret-key',
        {
          baseUrl: 'https://candidate.example/openai/',
          primaryModel: 'candidate-model',
        },
        fetcher,
      ),
    ).resolves.toBe(true)

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://candidate.example/openai/chat/completions')
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({ model: 'candidate-model' }),
    )

    const failing = vi.fn<typeof fetch>().mockRejectedValue(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(validateGeminiKey('do-not-log', {}, failing)).resolves.toBe(
      false,
    )
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('do-not-log')
    errorSpy.mockRestore()
  })

  it('returns false when the probe returns non-2xx or a non-JSON body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const unauthorized = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 401 }))
    await expect(
      validateGeminiKey('bad-key', {}, unauthorized),
    ).resolves.toBe(false)
    expect(JSON.stringify(errorSpy.mock.calls[0])).toContain('401')

    const nonJson = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>', { status: 200 }))
    await expect(validateGeminiKey('bad-key', {}, nonJson)).resolves.toBe(
      false,
    )
    errorSpy.mockRestore()
  })
})
