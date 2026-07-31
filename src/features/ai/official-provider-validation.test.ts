import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { validateOfficialByokKey } from './official-provider-validation'

describe('official BYOK validation', () => {
  it.each([
    ['stepfun', 'https://api.stepfun.com/v1/models', 'Authorization'],
    ['mimo', 'https://api.xiaomimimo.com/v1/models', 'api-key'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/models', 'Authorization'],
    ['openai', 'https://api.openai.com/v1/models', 'Authorization'],
    ['anthropic', 'https://api.anthropic.com/v1/models', 'x-api-key'],
  ] as const)(
    'validates %s only against its fixed official endpoint',
    async (provider, endpoint, header) => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))

    await expect(validateOfficialByokKey(
      provider,
      'workspace-key',
      fetcher,
    )).resolves.toBe(true)

    expect(fetcher).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        headers: expect.objectContaining({
          [header]: header === 'Authorization'
            ? 'Bearer workspace-key'
            : 'workspace-key',
        }),
      }),
    )
    },
  )

  it('rejects non-success responses and network failures', async () => {
    await expect(validateOfficialByokKey(
      'openai',
      'rejected-key',
      vi.fn(async () => new Response('{}', { status: 401 })),
    )).resolves.toBe(false)
    await expect(validateOfficialByokKey(
      'anthropic',
      'network-key',
      vi.fn(async () => {
        throw new Error('network unavailable')
      }),
    )).resolves.toBe(false)
  })
})
