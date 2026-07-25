import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getStoredApiKey,
  saveApiKey,
  StepfunAdapter,
  validateKey,
} from './stepfun-adapter'

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'mocked content' } }],
  }),
  getConfig: vi.fn(),
  loadSecret: vi.fn(),
  openAiConstructor: vi.fn(),
  resolveBaseUrl: vi.fn(),
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
  resolveStepfunBaseUrl: mocks.resolveBaseUrl,
}))
vi.mock('openai', () => {
  class MockAPIError extends Error {
    readonly status?: number
    constructor(message: string, status?: number) {
      super(message)
      this.status = status
    }
  }
  return {
    default: class MockOpenAI {
      static readonly APIError = MockAPIError
      readonly chat = { completions: { create: mocks.create } }
      constructor(options: unknown) {
        mocks.openAiConstructor(options)
      }
    },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveBaseUrl.mockReturnValue('https://api.stepfun.com/v1')
  mocks.getConfig.mockResolvedValue({
    apiKey: null,
    baseUrl: 'https://api.stepfun.com/v1',
    chatModel: 'step-3.5-flash',
    ttsModel: 'stepaudio-2.5-tts',
    asrModel: 'stepaudio-2.5-asr',
    visionModel: 'step-3.7-flash',
  })
})

describe('StepfunAdapter', () => {
  it('initializes the compatible client with the server-only endpoint', () => {
    new StepfunAdapter('test-key')

    expect(mocks.openAiConstructor).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'https://api.stepfun.com/v1',
    })
  })

  it('uses an explicit model or the asynchronously resolved model', async () => {
    const adapter = new StepfunAdapter('test-key')
    await adapter.chat(
      [{ role: 'user', content: 'hello' }],
      { model: 'explicit-model' },
    )
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'explicit-model' }),
    )

    await adapter.chat([{ role: 'user', content: 'hello' }])
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'step-3.5-flash' }),
    )
  })

  it('reads and writes credentials only through the encrypted store', async () => {
    mocks.loadSecret.mockResolvedValue('stored-key')
    await expect(getStoredApiKey()).resolves.toBe('stored-key')
    const verifiedAt = new Date('2026-07-25T00:00:00.000Z')
    await saveApiKey('new-key', verifiedAt)

    expect(mocks.loadSecret).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      'stepfun',
    )
    expect(mocks.saveSecret).toHaveBeenCalledWith({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      provider: 'stepfun',
      secret: 'new-key',
      verifiedAt,
    })
  })
})

describe('validateKey', () => {
  it('probes with a minimal completion using the resolved model', async () => {
    await expect(validateKey('sk-valid')).resolves.toBe(true)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'step-3.5-flash',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      expect.anything(),
    )
  })

  it('returns false and logs server-side without leaking the key', async () => {
    mocks.create.mockRejectedValueOnce(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(validateKey('sk-super-secret')).resolves.toBe(false)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain('sk-super-secret')
    errorSpy.mockRestore()
  })
})
