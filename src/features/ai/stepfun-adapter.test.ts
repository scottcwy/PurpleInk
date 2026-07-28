import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStoredApiKey, saveApiKey, validateKey } from './stepfun-adapter'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  loadSecret: vi.fn(),
  saveSecret: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('./config', () => ({
  getAiConfigDependencies: () => ({
    credentials: {
      loadSecret: mocks.loadSecret,
      save: mocks.saveSecret,
    },
  }),
  getStepfunConfig: mocks.getConfig,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getConfig.mockResolvedValue({
    apiKey: null,
    baseUrl: 'https://api.stepfun.com/v1',
    chatModel: 'step-3.5-flash',
    ttsModel: 'stepaudio-2.5-tts',
    asrModel: 'stepaudio-2.5-asr',
    visionModel: 'step-3.7-flash',
  })
})

describe('credentials', () => {
  it('reads only the managed credential and rejects workspace writes', async () => {
    process.env.CVC_MANAGED_STEPFUN_API_KEY = 'managed-key'
    await expect(getStoredApiKey()).resolves.toBe('managed-key')
    const verifiedAt = new Date('2026-07-25T00:00:00.000Z')
    await expect(saveApiKey('new-key', verifiedAt)).rejects.toThrow('托管凭据')

    expect(mocks.loadSecret).not.toHaveBeenCalled()
    expect(mocks.saveSecret).not.toHaveBeenCalled()
  })
})

describe('validateKey', () => {
  it('probes chat/completions with the resolved model over fetch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))

    await expect(validateKey('sk-valid', fetcher)).resolves.toBe(true)

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.stepfun.com/v1/chat/completions')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer sk-valid',
    )
    expect(new Headers(init?.headers).get('content-type')).toBe(
      'application/json',
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'step-3.5-flash',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns false on a non-2xx probe without leaking the key', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('unauthorized', { status: 401 }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(validateKey('sk-bad-key', fetcher)).resolves.toBe(false)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(errorSpy.mock.calls[0])).toContain('401')
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain('sk-bad-key')
    errorSpy.mockRestore()
  })

  it('returns false on a 200 response with a non-JSON body', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>', { status: 200 }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(validateKey('sk-valid', fetcher)).resolves.toBe(false)
    errorSpy.mockRestore()
  })

  it('returns false and logs server-side without leaking the key', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(validateKey('sk-super-secret', fetcher)).resolves.toBe(false)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain(
      'sk-super-secret',
    )
    errorSpy.mockRestore()
  })
})
