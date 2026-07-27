import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteContractError } from '@/features/ai/route-contract-error'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({
  describeCredential: vi.fn(),
  saveApiKey: vi.fn(),
  validateKey: vi.fn(),
  describeStepfunConfig: vi.fn(),
  saveStepfunModelSettings: vi.fn(),
  describeGeminiConfig: vi.fn(),
  saveGeminiSettings: vi.fn(),
  saveGeminiApiKey: vi.fn(),
  validateGeminiKey: vi.fn(),
  describeMimoConfig: vi.fn(),
  saveMimoSettings: vi.fn(),
  saveMimoApiKey: vi.fn(),
  validateMimoKey: vi.fn(),
  describeDirectorRoutes: vi.fn(),
  saveDirectorRoutes: vi.fn(),
  describeLaneQuotas: vi.fn(),
  saveLaneQuotas: vi.fn(),
  describeOpenAiCompatibleProfile: vi.fn(),
  saveOpenAiCompatibleProfile: vi.fn(),
  validateOpenAiCompatibleProfile: vi.fn(),
}))

vi.mock('server-only', () => ({}))

// route.ts 对 renderShot 做运行时 cpu 上限校验——固定为 4 保证 suite 可复现。
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  const stubbedOs = {
    ...original,
    cpus: () => Array.from({ length: 4 }),
  }
  return { ...original, default: stubbedOs }
})

const MOCK_DEFAULT_LANE_VIEW = {
  directorStage: { value: 12, source: 'default' },
  renderShot: { value: 2, source: 'default' },
} as const
vi.mock('@/features/ai/stepfun-adapter', () => ({
  saveApiKey: mocks.saveApiKey,
  validateKey: mocks.validateKey,
}))
vi.mock('@/features/ai/config', () => ({
  describeStepfunConfig: mocks.describeStepfunConfig,
  getAiConfigDependencies: () => ({
    credentials: { describe: mocks.describeCredential },
    openAiCompatibleProfiles: {
      find: vi.fn(),
      save: vi.fn(),
    },
  }),
  saveStepfunModelSettings: mocks.saveStepfunModelSettings,
}))
vi.mock('@/features/ai/gemini-config', () => ({
  describeGeminiConfig: mocks.describeGeminiConfig,
  saveGeminiSettings: mocks.saveGeminiSettings,
  saveGeminiApiKey: mocks.saveGeminiApiKey,
}))
vi.mock('@/features/ai/gemini-adapter', () => ({
  validateGeminiKey: mocks.validateGeminiKey,
}))
vi.mock('@/features/ai/mimo-config', () => ({
  describeMimoConfig: mocks.describeMimoConfig,
  saveMimoSettings: mocks.saveMimoSettings,
  saveMimoApiKey: mocks.saveMimoApiKey,
}))
vi.mock('@/features/ai/mimo-adapter', () => ({
  validateMimoKey: mocks.validateMimoKey,
}))
vi.mock('@/features/ai/model-routing', () => ({
  describeDirectorRoutes: mocks.describeDirectorRoutes,
  saveDirectorRoutes: mocks.saveDirectorRoutes,
}))
vi.mock('@/features/ai/openai-compatible-config', () => ({
  describeOpenAiCompatibleProfile: mocks.describeOpenAiCompatibleProfile,
  saveOpenAiCompatibleProfile: mocks.saveOpenAiCompatibleProfile,
  validateOpenAiCompatibleProfile: mocks.validateOpenAiCompatibleProfile,
}))
vi.mock('@/lib/queue/runtime-config', () => ({
  describeLaneQuotas: mocks.describeLaneQuotas,
  saveLaneQuotas: mocks.saveLaneQuotas,
}))

describe('GET /api/settings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns secret-free credential descriptions and effective routes', async () => {
    mocks.describeCredential.mockImplementation(
      async (_workspaceId: string, provider: string) => ({
        configured: provider === 'stepfun',
        verifiedAt: provider === 'stepfun'
          ? '2026-07-25T01:02:03.000Z'
          : null,
        updatedAt: provider === 'stepfun'
          ? '2026-07-25T01:02:04.000Z'
          : null,
      }),
    )
    mocks.describeStepfunConfig.mockResolvedValue({
      baseUrl: { value: 'https://api.stepfun.com/v1', source: 'default' },
      chatModel: { value: 'step-3.5-flash', source: 'env' },
      ttsModel: { value: 'stepaudio-2.5-tts', source: 'default' },
      asrModel: { value: 'stepaudio-2.5-asr', source: 'default' },
      visionModel: { value: 'step-3.7-flash', source: 'default' },
    })
    mocks.describeGeminiConfig.mockResolvedValue({
      baseUrl: { value: 'https://google.test/openai/', source: 'default' },
      primaryModel: { value: 'gemini-3.6-flash', source: 'default' },
      fastModel: { value: 'gemini-3.1-flash-lite', source: 'default' },
    })
    mocks.describeDirectorRoutes.mockResolvedValue({
      'shot-codegen': {
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        source: 'default',
      },
    })
    mocks.describeLaneQuotas.mockResolvedValue(MOCK_DEFAULT_LANE_VIEW)
    mocks.describeOpenAiCompatibleProfile.mockResolvedValue({
      configured: false,
      verifiedAt: null,
      baseUrl: null,
      defaultModel: null,
    })
    mocks.describeMimoConfig.mockResolvedValue({
      baseUrl: { value: 'https://api.xiaomimimo.com/v1', source: 'default' },
      textModel: { value: 'mimo-v2.5', source: 'default' },
      visionModel: { value: 'mimo-v2.5', source: 'default' },
      ttsModel: { value: 'mimo-v2.5-tts', source: 'default' },
      asrModel: { value: 'mimo-v2.5-asr', source: 'default' },
    })

    const response = await GET()
    const body = await response.json()

    expect(body.configured).toBe(true)
    expect(body.verifiedAt).toBe('2026-07-25T01:02:03.000Z')
    expect(body.updatedAt).toBe('2026-07-25T01:02:04.000Z')
    expect(body).not.toHaveProperty('masked')
    expect(body.models.chatModel).toEqual({ value: 'step-3.5-flash', source: 'env' })
    expect(body.geminiConfigured).toBe(false)
    expect(body.geminiCredential).toEqual({
      configured: false,
      verifiedAt: null,
      updatedAt: null,
    })
    expect(body.gemini.primaryModel.value).toBe('gemini-3.6-flash')
    expect(body.mimo.textModel.value).toBe('mimo-v2.5')
    expect(body.mimoCredential.configured).toBe(false)
    expect(body.routes['shot-codegen'].provider).toBe('gemini')
    expect(body.laneQuotas).toEqual(MOCK_DEFAULT_LANE_VIEW)
    expect(mocks.describeCredential).toHaveBeenCalledTimes(3)
  })
})

describe('POST /api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.describeCredential.mockResolvedValue({
      configured: false,
      verifiedAt: null,
      updatedAt: null,
    })
    mocks.describeStepfunConfig.mockResolvedValue({})
    mocks.describeGeminiConfig.mockResolvedValue({})
    mocks.describeMimoConfig.mockResolvedValue({})
    mocks.describeDirectorRoutes.mockResolvedValue({})
    mocks.describeLaneQuotas.mockResolvedValue(MOCK_DEFAULT_LANE_VIEW)
    mocks.saveStepfunModelSettings.mockResolvedValue(undefined)
    mocks.saveGeminiSettings.mockResolvedValue(undefined)
    mocks.saveMimoSettings.mockResolvedValue(undefined)
    mocks.saveDirectorRoutes.mockResolvedValue(undefined)
    mocks.saveApiKey.mockResolvedValue(undefined)
    mocks.saveGeminiApiKey.mockResolvedValue(undefined)
    mocks.saveMimoApiKey.mockResolvedValue(undefined)
    mocks.saveLaneQuotas.mockResolvedValue(undefined)
    mocks.saveOpenAiCompatibleProfile.mockResolvedValue(undefined)
  })

  it('validates and saves a custom OpenAI-compatible profile without returning its key', async () => {
    mocks.validateOpenAiCompatibleProfile.mockResolvedValue({ ok: true })
    const input = {
      apiKey: 'candidate-secret',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      defaultModel: 'mimo-v2.5-pro',
    }

    const response = await POST(request({ customOpenAi: input }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.validateOpenAiCompatibleProfile).toHaveBeenCalledWith(input)
    expect(mocks.saveOpenAiCompatibleProfile).toHaveBeenCalledWith(input, expect.anything())
    expect(body).not.toContain('candidate-secret')
  })

  it('rejects a MiMo Token Plan key without replacing the stored credential', async () => {
    mocks.validateMimoKey.mockResolvedValue({
      ok: false,
      reason: 'token-plan-not-for-backend',
    })

    const response = await POST(request({
      mimo: { apiKey: 'tp-not-for-product-backend' },
    }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toContain('Token Plan')
    expect(mocks.saveMimoApiKey).not.toHaveBeenCalled()
  })

  it('validates and saves a MiMo product API key and model settings', async () => {
    mocks.validateMimoKey.mockResolvedValue({ ok: true })
    const response = await POST(request({
      mimo: {
        apiKey: 'sk-product-api-key',
        textModel: 'mimo-v2.5',
        ttsModel: 'mimo-v2.5-tts',
      },
      routes: {
        'shot-codegen': 'mimo',
        'shot-sfx': 'mimo',
      },
    }))

    expect(response.status).toBe(200)
    expect(mocks.validateMimoKey).toHaveBeenCalledWith(
      'sk-product-api-key',
      {
        textModel: 'mimo-v2.5',
        ttsModel: 'mimo-v2.5-tts',
      }
    )
    expect(mocks.saveMimoApiKey).toHaveBeenCalledWith('sk-product-api-key')
    expect(mocks.saveMimoSettings).toHaveBeenCalledWith({
      textModel: 'mimo-v2.5',
      ttsModel: 'mimo-v2.5-tts',
    })
  })

  it('validates before saving a StepFun Key', async () => {
    mocks.validateKey.mockResolvedValue(true)
    const response = await POST(request({ apiKey: 'sk-valid-value' }))

    expect(response.status).toBe(200)
    expect(mocks.validateKey).toHaveBeenCalledWith('sk-valid-value')
    expect(mocks.saveApiKey).toHaveBeenCalledWith('sk-valid-value')
    expect(mocks.validateKey.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveApiKey.mock.invocationCallOrder[0]!
    )
  })

  it('never persists a Key that fails validation', async () => {
    mocks.validateKey.mockResolvedValue(false)
    const response = await POST(request({ apiKey: 'sk-invalid-value' }))

    expect(response.status).toBe(422)
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
    expect(mocks.saveStepfunModelSettings).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      ok: false,
      valid: false,
      error: 'StepFun Key 校验失败 · 请检查 Key 是否正确',
    })
  })

  it('saves model settings without requiring or validating an apiKey', async () => {
    const response = await POST(request({ chatModel: 'step-3.5-flash', ttsModel: '' }))

    expect(response.status).toBe(200)
    expect(mocks.validateKey).not.toHaveBeenCalled()
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
    expect(mocks.saveStepfunModelSettings).toHaveBeenCalledWith({
      chatModel: 'step-3.5-flash',
      ttsModel: '',
    })
  })

  it('applies apiKey and model settings together only after validation succeeds', async () => {
    mocks.validateKey.mockResolvedValue(true)
    const response = await POST(request({
      apiKey: 'sk-valid-value',
      baseUrl: 'https://api.stepfun.com/v1',
    }))

    expect(response.status).toBe(200)
    expect(mocks.saveApiKey).toHaveBeenCalledWith('sk-valid-value')
    expect(mocks.saveStepfunModelSettings).toHaveBeenCalledWith({
      baseUrl: 'https://api.stepfun.com/v1',
    })
  })

  it('does not save a validated key when a custom base URL is rejected', async () => {
    mocks.validateKey.mockResolvedValue(true)
    mocks.saveStepfunModelSettings.mockRejectedValueOnce(
      new Error('Persisting a custom StepFun baseUrl is unsupported'),
    )

    await expect(POST(request({
      apiKey: 'sk-valid-value',
      baseUrl: 'https://custom.example/v1',
    }))).rejects.toThrow('custom StepFun baseUrl')
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
  })

  it('validates and saves Gemini candidate config without replacing StepFun', async () => {
    mocks.validateGeminiKey.mockResolvedValue(true)
    const response = await POST(
      request({
        gemini: {
          apiKey: 'gemini-valid',
          primaryModel: 'gemini-3.6-flash',
        },
        routes: {
          'shot-codegen': 'gemini',
          'shot-sfx': 'stepfun',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.validateGeminiKey).toHaveBeenCalledWith('gemini-valid', {
      primaryModel: 'gemini-3.6-flash',
    })
    expect(mocks.saveGeminiApiKey).toHaveBeenCalledWith('gemini-valid')
    expect(mocks.saveGeminiSettings).toHaveBeenCalledWith({
      primaryModel: 'gemini-3.6-flash',
    })
    expect(mocks.saveDirectorRoutes).toHaveBeenCalledWith({
      'shot-codegen': 'gemini',
      'shot-sfx': 'stepfun',
    })
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
  })

  it('does not persist Gemini key/config/routes when validation fails', async () => {
    mocks.validateGeminiKey.mockResolvedValue(false)
    const response = await POST(
      request({
        gemini: { apiKey: 'gemini-invalid', fastModel: 'candidate-fast' },
        routes: { 'script-import': 'gemini' },
      })
    )

    expect(response.status).toBe(422)
    expect(mocks.saveGeminiApiKey).not.toHaveBeenCalled()
    expect(mocks.saveGeminiSettings).not.toHaveBeenCalled()
    expect(mocks.saveDirectorRoutes).not.toHaveBeenCalled()
  })

  it('returns 422 for an invalid route contract before saving unrelated settings', async () => {
    mocks.saveDirectorRoutes.mockRejectedValueOnce(
      new RouteContractError('OpenAI 兼容模型服务尚未配置'),
    )

    const response = await POST(request({
      chatModel: 'step-3.5-flash',
      routes: { export: 'openai-compatible' },
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      valid: false,
      error: 'OpenAI 兼容模型服务尚未配置',
    })
    expect(mocks.saveStepfunModelSettings).not.toHaveBeenCalled()
    expect(mocks.saveGeminiSettings).not.toHaveBeenCalled()
    expect(mocks.saveMimoSettings).not.toHaveBeenCalled()
  })
})

describe('POST /api/settings lane quotas (ISSUE-011)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.describeCredential.mockResolvedValue({
      configured: false,
      verifiedAt: null,
      updatedAt: null,
    })
    mocks.describeStepfunConfig.mockResolvedValue({})
    mocks.describeGeminiConfig.mockResolvedValue({})
    mocks.describeDirectorRoutes.mockResolvedValue({})
    mocks.describeLaneQuotas.mockResolvedValue(MOCK_DEFAULT_LANE_VIEW)
    mocks.saveStepfunModelSettings.mockResolvedValue(undefined)
    mocks.saveGeminiSettings.mockResolvedValue(undefined)
    mocks.saveDirectorRoutes.mockResolvedValue(undefined)
    mocks.saveApiKey.mockResolvedValue(undefined)
    mocks.saveGeminiApiKey.mockResolvedValue(undefined)
    mocks.saveLaneQuotas.mockResolvedValue(undefined)
  })

  it('persists valid lane quotas and signals requiresRestart=true', async () => {
    const response = await POST(request({
      laneQuotas: { directorStageConcurrency: 4, renderShotConcurrency: 2 },
    }))

    expect(response.status).toBe(200)
    expect(mocks.saveLaneQuotas).toHaveBeenCalledWith({
      directorStage: 4,
      renderShot: 2,
    })
    const body = await response.json()
    expect(body.requiresRestart).toBe(true)
    expect(body.laneQuotas).toEqual(MOCK_DEFAULT_LANE_VIEW)
  })

  it('does not call saveLaneQuotas when laneQuotas is omitted', async () => {
    const response = await POST(request({ chatModel: 'step-3.5-flash' }))

    expect(response.status).toBe(200)
    expect(mocks.saveLaneQuotas).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.requiresRestart).toBe(false)
  })

  it('rejects directorStage=0 with 400 and does not persist anything', async () => {
    const response = await POST(request({
      laneQuotas: { directorStageConcurrency: 0, renderShotConcurrency: 2 },
    }))

    expect(response.status).toBe(400)
    expect(mocks.saveLaneQuotas).not.toHaveBeenCalled()
    expect(mocks.saveStepfunModelSettings).not.toHaveBeenCalled()
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
  })

  it('rejects renderShotConcurrency=-1 with 400', async () => {
    const response = await POST(request({
      laneQuotas: { directorStageConcurrency: 4, renderShotConcurrency: -1 },
    }))

    expect(response.status).toBe(400)
    expect(mocks.saveLaneQuotas).not.toHaveBeenCalled()
  })

  it('rejects non-integer 1.5 with 400', async () => {
    const response = await POST(request({
      laneQuotas: { directorStageConcurrency: 1.5, renderShotConcurrency: 2 },
    }))

    expect(response.status).toBe(400)
    expect(mocks.saveLaneQuotas).not.toHaveBeenCalled()
  })

  it('rejects directorStage=33 (over schema max 32) with 400', async () => {
    const response = await POST(request({
      laneQuotas: { directorStageConcurrency: 33, renderShotConcurrency: 2 },
    }))

    expect(response.status).toBe(400)
    expect(mocks.saveLaneQuotas).not.toHaveBeenCalled()
  })

  it('rejects renderShotConcurrency=5 (over runtime CPU count=4) with 400', async () => {
    const response = await POST(request({
      laneQuotas: { directorStageConcurrency: 4, renderShotConcurrency: 5 },
    }))

    expect(response.status).toBe(400)
    expect(mocks.saveLaneQuotas).not.toHaveBeenCalled()
    expect(mocks.saveStepfunModelSettings).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.error).toMatch(/CPU/)
  })

  it('does not persist lane quotas when a StepFun key in the same request fails validation', async () => {
    mocks.validateKey.mockResolvedValue(false)
    const response = await POST(request({
      apiKey: 'sk-invalid',
      laneQuotas: { directorStageConcurrency: 4, renderShotConcurrency: 2 },
    }))

    expect(response.status).toBe(422)
    expect(mocks.saveLaneQuotas).not.toHaveBeenCalled()
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
  })

  it('persists lane quotas and a validated StepFun key in the same request', async () => {
    mocks.validateKey.mockResolvedValue(true)
    const response = await POST(request({
      apiKey: 'sk-valid',
      laneQuotas: { directorStageConcurrency: 4, renderShotConcurrency: 2 },
    }))

    expect(response.status).toBe(200)
    expect(mocks.saveApiKey).toHaveBeenCalledWith('sk-valid')
    expect(mocks.saveLaneQuotas).toHaveBeenCalledWith({
      directorStage: 4,
      renderShot: 2,
    })
  })
})

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
