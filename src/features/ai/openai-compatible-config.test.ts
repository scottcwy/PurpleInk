import { describe, expect, it, vi } from 'vitest'
import {
  describeOpenAiCompatibleProfile,
  saveOpenAiCompatibleProfile,
  validateOpenAiCompatibleProfile,
  type OpenAiCompatibleDependencies,
} from './openai-compatible-config'
import type { OpenAiCompatibleProfile } from './openai-compatible-payloads'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

vi.mock('server-only', () => ({}))

describe('OpenAI-compatible provider profile', () => {
  it('saves an encrypted key separately from endpoint and models', async () => {
    const test = harness()

    await saveOpenAiCompatibleProfile(
      {
        apiKey: 'candidate-secret',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/',
        textModel: 'mimo-v2.5-pro',
        visionModel: 'mimo-v2.5-vision',
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
      textModel: { value: 'mimo-v2.5-pro', source: 'settings' },
      visionModel: { value: 'mimo-v2.5-vision', source: 'settings' },
    })
  })

  it('keeps the vision model absent when it is left blank', async () => {
    const test = harness()

    await saveOpenAiCompatibleProfile(
      {
        apiKey: 'candidate-secret',
        baseUrl: 'https://example.test/v1',
        textModel: 'text-only-model',
        visionModel: '',
      },
      test.dependencies,
    )

    await expect(
      describeOpenAiCompatibleProfile(test.dependencies),
    ).resolves.toMatchObject({ visionModel: null })
  })

  it('probes the standard OpenAI chat-completions endpoint with Bearer auth', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200 }))

    await expect(validateOpenAiCompatibleProfile({
      apiKey: 'candidate-secret',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      textModel: 'mimo-v2.5-pro',
    }, fetcher)).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer candidate-secret' }),
      }),
    )
  })

  /**
   * 视觉模型必须用真实图像输入探测：只发文本请求只能证明模型 ID 存在，无法证明它
   * 接受图像，而分镜验收正是靠图像输入工作的。
   */
  it('probes the vision model separately with an image part', async () => {
    const calls: Array<Record<string, unknown>> = []
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response('{}', { status: 200 })
    })

    await expect(validateOpenAiCompatibleProfile({
      apiKey: 'candidate-secret',
      baseUrl: 'https://example.test/v1',
      textModel: 'text-model',
      visionModel: 'vision-model',
    }, fetcher as unknown as typeof fetch)).resolves.toEqual({ ok: true })

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ model: 'text-model' })
    expect(JSON.stringify(calls[1])).toContain('image_url')
    expect(JSON.stringify(calls[1])).toContain('data:image/png;base64,')
  })

  it('reports which model was rejected so the user edits the right field', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      String(init?.body).includes('image_url')
        ? new Response('unsupported', { status: 400 })
        : new Response('{}', { status: 200 }),
    )

    await expect(validateOpenAiCompatibleProfile({
      apiKey: 'candidate-secret',
      baseUrl: 'https://example.test/v1',
      textModel: 'text-model',
      visionModel: 'text-only-model',
    }, fetcher as unknown as typeof fetch)).resolves.toEqual({
      ok: false,
      field: 'visionModel',
      status: 400,
    })
  })
})

function harness() {
  let profile: OpenAiCompatibleProfile | null = null
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
    save: vi.fn(async (_workspaceId: string, value: OpenAiCompatibleProfile) => {
      profile = value
    }),
  }
  return {
    dependencies: { credentials, profileStore } satisfies OpenAiCompatibleDependencies,
    credentials,
    profileStore,
  }
}
