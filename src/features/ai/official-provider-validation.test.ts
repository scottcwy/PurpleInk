import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { validateOfficialByokKey } from './official-provider-validation'

describe('official BYOK validation', () => {
  it('validates OpenAI only against the fixed official models endpoint', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))

    await expect(validateOfficialByokKey(
      'openai',
      'workspace-openai-key',
      fetcher,
    )).resolves.toBe(true)

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer workspace-openai-key',
        }),
      }),
    )
  })

  it('validates Anthropic only against the fixed official models endpoint', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))

    await expect(validateOfficialByokKey(
      'anthropic',
      'workspace-anthropic-key',
      fetcher,
    )).resolves.toBe(true)

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'workspace-anthropic-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    )
  })

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
