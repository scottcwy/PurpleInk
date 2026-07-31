import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('callStepMessages request deadline', () => {
  it('aborts a provider request that never returns', async () => {
    vi.stubEnv('STEP_API_KEY', 'test-only')
    vi.stubEnv('STEP_MAX_RETRIES', '0')
    vi.stubEnv('STEP_REQUEST_TIMEOUT_MS', '25')
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        )
      }),
    ))
    const { callStepMessages } = await import('./step-client')

    await expect(callStepMessages({
      system: 'system',
      content: [{ type: 'text', text: 'content' }],
      maxTokens: 10,
    })).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
