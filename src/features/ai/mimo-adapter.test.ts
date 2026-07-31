import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMimoConfig = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('./mimo-config', () => ({ getMimoConfig }))

import {
  validateMimoCredentialFormat,
  validateMimoKey,
} from './mimo-adapter'

describe('MiMo credential validation', () => {
  beforeEach(() => {
    getMimoConfig.mockResolvedValue({
      baseUrl: 'https://api.xiaomimimo.com/v1',
      textModel: 'mimo-v2.5',
    })
  })

  it('rejects Token Plan credentials for a product backend', () => {
    expect(validateMimoCredentialFormat('tp-secret')).toEqual({
      ok: false,
      reason: 'token-plan-not-for-backend',
    })
  })

  it('uses the official API key header and a real minimal inference', async () => {
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = []
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requests.push([input, init])
      return Response.json({
        choices: [{ message: { content: 'pong' } }],
      })
    })

    await expect(validateMimoKey('sk-product-key', {}, fetcher))
      .resolves.toEqual({ ok: true })

    const [url, init] = requests[0]!
    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(init?.headers).toMatchObject({
      'api-key': 'sk-product-key',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'mimo-v2.5',
      max_completion_tokens: 1,
    })
  })

  it('returns a safe status without exposing the credential', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: { message: 'raw provider response' } }, {
        status: 401,
      })
    )

    await expect(validateMimoKey('sk-product-key', {}, fetcher))
      .resolves.toEqual({ ok: false, reason: 'provider-failed', status: 401 })
    expect(JSON.stringify(fetcher.mock.results)).not.toContain('sk-product-key')
  })
})
