import { describe, expect, it, vi } from 'vitest'
import {
  describeOpenAiCompatibleProfile,
  saveOpenAiCompatibleProfile,
  validateOpenAiCompatibleProfile,
  type OpenAiCompatibleDependencies,
} from './openai-compatible-config'

vi.mock('server-only', () => ({}))

describe('OpenAI-compatible provider profile', () => {
  it('saves an encrypted key separately from endpoint and default model', async () => {
    const test = harness()

    await saveOpenAiCompatibleProfile(
      {
        apiKey: 'candidate-secret',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/',
        defaultModel: 'mimo-v2.5-pro',
      },
      test.dependencies,
    )

    expect(test.credentials.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-compatible',
        secret: 'candidate-secret',
      }),
    )
    await expect(describeOpenAiCompatibleProfile(test.dependencies)).resolves.toEqual({
      configured: true,
      verifiedAt: '2026-07-26T00:00:00.000Z',
      baseUrl: {
        value: 'https://token-plan-cn.xiaomimimo.com/v1',
        source: 'settings',
      },
      defaultModel: { value: 'mimo-v2.5-pro', source: 'settings' },
    })
  })

  it('probes the standard OpenAI chat-completions endpoint with Bearer auth', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200 }))

    await expect(validateOpenAiCompatibleProfile({
      apiKey: 'candidate-secret',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      defaultModel: 'mimo-v2.5-pro',
    }, fetcher)).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledWith(
      'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer candidate-secret' }),
      }),
    )
  })
})

function harness() {
  let profile: { baseUrl: string; defaultModel: string } | null = null
  const credentials = {
    save: vi.fn(async () => {}),
    describe: vi.fn(async () => ({
      configured: true,
      verifiedAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    })),
  }
  const profileStore = {
    find: vi.fn(async () => profile),
    save: vi.fn(async (_workspaceId: string, value: { baseUrl: string; defaultModel: string }) => {
      profile = value
    }),
  }
  return {
    dependencies: { credentials, profileStore } satisfies OpenAiCompatibleDependencies,
    credentials,
    profileStore,
  }
}
