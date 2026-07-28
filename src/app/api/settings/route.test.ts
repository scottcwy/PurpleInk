import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteContractError } from '@/features/ai/route-contract-error'
import { GET, POST } from './route'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

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
  describeTtsProfile: vi.fn(),
  describeAsrProfile: vi.fn(),
  saveTtsProfile: vi.fn(),
  saveAsrProfile: vi.fn(),
  validateTtsProfile: vi.fn(),
  validateAsrProfile: vi.fn(),
  findMediaRoute: vi.fn(),
  saveMediaRoute: vi.fn(),
  listManagedModels: vi.fn().mockResolvedValue([]),
  resolveProviderFunding: vi.fn().mockResolvedValue('managed'),
  saveCredential: vi.fn(),
  saveProviderFunding: vi.fn(),
}))

vi.mock('server-only', () => ({}))
// 会话层单独有 pg 测试覆盖；这里只验路由业务分支，直接以假会话放行。
vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: (session: unknown) => Promise<Response>) =>
    handler({
      userId: 'user-1',
      workspaceId: 'ws-1',
      email: 'user@example.com',
      name: '测试用户',
      workspaceName: '测试工作区',
      sessionId: 'session-1',
    }),
}))

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

const UNCONFIGURED_TTS_VIEW = {
  configured: false,
  verifiedAt: null,
  baseUrl: null,
  model: null,
  voice: null,
  audioFormat: null,
} as const

const UNCONFIGURED_ASR_VIEW = {
  configured: false,
  verifiedAt: null,
  baseUrl: null,
  model: null,
  timestampMode: null,
  verification: null,
} as const
vi.mock('@/features/ai/stepfun-adapter', () => ({
  saveApiKey: mocks.saveApiKey,
  validateKey: mocks.validateKey,
}))
vi.mock('@/features/ai/config', () => ({
  describeStepfunConfig: mocks.describeStepfunConfig,
  resolveProviderFunding: mocks.resolveProviderFunding,
  getAiConfigDependencies: () => ({
    credentials: {
      describe: mocks.describeCredential,
      save: mocks.saveCredential,
    },
    providerFunding: { save: mocks.saveProviderFunding },
    mediaRoutes: {
      find: mocks.findMediaRoute,
      save: mocks.saveMediaRoute,
    },
    openAiCompatibleProfiles: {
      find: vi.fn(),
      save: vi.fn(),
    },
    openAiCompatibleAudioProfiles: {
      findTts: vi.fn(),
      saveTts: vi.fn(),
      findAsr: vi.fn(),
      saveAsr: vi.fn(),
    },
  }),
  saveStepfunModelSettings: mocks.saveStepfunModelSettings,
}))
vi.mock('@/features/ai/openai-compatible-audio-config', () => ({
  CUSTOM_TTS_PROVIDER: 'openai-compatible-tts',
  CUSTOM_ASR_PROVIDER: 'openai-compatible-asr',
  describeTtsProfile: mocks.describeTtsProfile,
  describeAsrProfile: mocks.describeAsrProfile,
  saveTtsProfile: mocks.saveTtsProfile,
  saveAsrProfile: mocks.saveAsrProfile,
  validateTtsProfile: mocks.validateTtsProfile,
  validateAsrProfile: mocks.validateAsrProfile,
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
vi.mock('@/features/ai/managed-model-catalog-repository', () => ({
  managedModelCatalogRepository: {
    listEnabled: mocks.listManagedModels,
  },
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
      textModel: null,
      visionModel: null,
    })
    mocks.describeTtsProfile.mockResolvedValue(UNCONFIGURED_TTS_VIEW)
    mocks.describeAsrProfile.mockResolvedValue(UNCONFIGURED_ASR_VIEW)
    mocks.describeMimoConfig.mockResolvedValue({
      baseUrl: { value: 'https://api.xiaomimimo.com/v1', source: 'default' },
      textModel: { value: 'mimo-v2.5', source: 'default' },
      visionModel: { value: 'mimo-v2.5', source: 'default' },
      ttsModel: { value: 'mimo-v2.5-tts', source: 'default' },
      asrModel: { value: 'mimo-v2.5-asr', source: 'default' },
    })

    const response = await GET()
    const body = await response.json()

    expect(body.configured).toBe(false)
    expect(body.verifiedAt).toBeNull()
    expect(body.updatedAt).toBeNull()
    expect(body).not.toHaveProperty('masked')
    expect(body.models.chatModel).toEqual({ value: 'step-3.5-flash', source: 'env' })
    expect(body.geminiConfigured).toBe(false)
    expect(body.geminiCredential).toEqual({
      configured: false,
      verifiedAt: null,
      updatedAt: null,
      managed: true,
    })
    expect(body.gemini.primaryModel.value).toBe('gemini-3.6-flash')
    expect(body.mimo.textModel.value).toBe('mimo-v2.5')
    expect(body.mimoCredential.configured).toBe(false)
    expect(body.routes['shot-codegen'].provider).toBe('gemini')
    expect(body.laneQuotas).toEqual(MOCK_DEFAULT_LANE_VIEW)
    expect(mocks.describeCredential).toHaveBeenCalledTimes(3)
    expect(body.managedProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'stepfun',
        funding: 'managed',
        byokCredential: expect.objectContaining({ configured: true }),
      }),
    ]))
    expect(JSON.stringify(body)).not.toContain('workspace-key')
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
    mocks.describeTtsProfile.mockResolvedValue(UNCONFIGURED_TTS_VIEW)
    mocks.describeAsrProfile.mockResolvedValue(UNCONFIGURED_ASR_VIEW)
    mocks.saveTtsProfile.mockResolvedValue(undefined)
    mocks.saveAsrProfile.mockResolvedValue(undefined)
    mocks.findMediaRoute.mockResolvedValue(null)
    mocks.saveMediaRoute.mockResolvedValue(undefined)
  })

  it('validates and saves a custom TTS endpoint, resyncing a route that points at it', async () => {
    mocks.validateTtsProfile.mockResolvedValue({ ok: true })
    mocks.findMediaRoute.mockResolvedValue({
      workspaceId: 'workspace',
      mediaTaskKind: 'tts',
      provider: 'openai-compatible-tts',
      model: 'stale-model',
      revision: 3,
    })
    const input = {
      apiKey: 'tts-secret',
      baseUrl: 'https://example.test/v1',
      model: 'tts-1',
      voice: 'alloy',
      audioFormat: 'mp3',
    }

    const response = await POST(request({ customOpenAiTts: input }))

    expect(response.status).toBe(200)
    expect(mocks.validateTtsProfile).toHaveBeenCalledWith(input)
    expect(mocks.saveTtsProfile).toHaveBeenCalledWith(input, expect.anything())
    // media_routes.model 是设置页「当前模型」与执行侧的共同真值，必须跟着 profile 走。
    expect(mocks.saveMediaRoute).toHaveBeenCalledWith(expect.objectContaining({
      mediaTaskKind: 'tts',
      provider: 'openai-compatible-tts',
      model: 'tts-1',
    }))
    expect(await response.json()).not.toContain('tts-secret')
  })

  it('does not touch a media route that points at another provider', async () => {
    mocks.validateTtsProfile.mockResolvedValue({ ok: true })
    mocks.findMediaRoute.mockResolvedValue({
      workspaceId: 'workspace',
      mediaTaskKind: 'tts',
      provider: 'stepfun',
      model: 'stepaudio-2.5-tts',
      revision: 1,
    })

    const response = await POST(request({
      customOpenAiTts: {
        apiKey: 'tts-secret',
        baseUrl: 'https://example.test/v1',
        model: 'tts-1',
        voice: 'alloy',
        audioFormat: 'wav',
      },
    }))

    expect(response.status).toBe(200)
    expect(mocks.saveMediaRoute).not.toHaveBeenCalled()
  })

  it('never persists a TTS endpoint whose synthesis probe fails', async () => {
    mocks.validateTtsProfile.mockResolvedValue({ ok: false, status: 401 })

    const response = await POST(request({
      customOpenAiTts: {
        apiKey: 'tts-secret',
        baseUrl: 'https://example.test/v1',
        model: 'tts-1',
        voice: 'alloy',
        audioFormat: 'mp3',
      },
    }))

    expect(response.status).toBe(422)
    expect(mocks.saveTtsProfile).not.toHaveBeenCalled()
    expect((await response.json()).error).toContain('HTTP 401')
  })

  /** 协商结果必须从校验阶段传到保存阶段，不能在保存时重跑一次真实转写。 */
  it('persists the negotiated ASR timestamp capability', async () => {
    mocks.validateAsrProfile.mockResolvedValue({
      ok: true,
      timestampMode: 'segment',
      verification: 'transcription',
    })

    const response = await POST(request({
      customOpenAiAsr: {
        apiKey: 'asr-secret',
        baseUrl: 'https://example.test/v1',
        model: 'whisper-1',
      },
    }))

    expect(response.status).toBe(200)
    expect(mocks.saveAsrProfile).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-1' }),
      { timestampMode: 'segment', verification: 'transcription' },
      expect.anything(),
    )
  })

  /**
   * 转写被拒时回 422 + 机器可读的 reason，客户端据此弹窗并提供「仅校验凭据」。
   * 缺了 reason，UI 无法区分「端点拒收合成音」和「凭据无效」。
   */
  it('returns a machine-readable reason when the ASR transcription probe is rejected', async () => {
    mocks.validateAsrProfile.mockResolvedValue({
      ok: false,
      reason: 'transcription-rejected',
      status: 400,
    })

    const response = await POST(request({
      customOpenAiAsr: {
        apiKey: 'asr-secret',
        baseUrl: 'https://example.test/v1',
        model: 'whisper-1',
      },
    }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.reason).toBe('asr-transcription-rejected')
    expect(mocks.saveAsrProfile).not.toHaveBeenCalled()
  })

  it('rejects credential-only when the endpoint itself is unreachable', async () => {
    mocks.validateAsrProfile.mockResolvedValue({
      ok: false,
      reason: 'credential-rejected',
      status: 403,
    })

    const response = await POST(request({
      customOpenAiAsr: {
        apiKey: 'asr-secret',
        baseUrl: 'https://example.test/v1',
        model: 'whisper-1',
        credentialOnly: true,
      },
    }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.reason).toBeUndefined()
    expect(body.error).toContain('凭据校验失败')
    expect(mocks.saveAsrProfile).not.toHaveBeenCalled()
  })

  it('validates and saves a custom OpenAI-compatible profile without returning its key', async () => {
    mocks.validateOpenAiCompatibleProfile.mockResolvedValue({ ok: true })
    const input = {
      apiKey: 'candidate-secret',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      textModel: 'mimo-v2.5-pro',
      visionModel: 'mimo-v2.5-vision',
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
    expect(body.error).toContain('内置模型与旧凭据字段不接受写入')
    expect(mocks.validateMimoKey).not.toHaveBeenCalled()
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

    expect(response.status).toBe(422)
    expect(mocks.validateMimoKey).not.toHaveBeenCalled()
    expect(mocks.saveMimoApiKey).not.toHaveBeenCalled()
    expect(mocks.saveMimoSettings).not.toHaveBeenCalled()
  })

  it('validates before saving a StepFun Key', async () => {
    mocks.validateKey.mockResolvedValue(true)
    const response = await POST(request({ apiKey: 'sk-valid-value' }))

    expect(response.status).toBe(422)
    expect(mocks.validateKey).not.toHaveBeenCalled()
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
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
      error: '内置模型与旧凭据字段不接受写入，请使用服务来源配置',
    })
  })

  it('saves model settings without requiring or validating an apiKey', async () => {
    const response = await POST(request({ chatModel: 'step-3.5-flash', ttsModel: '' }))

    expect(response.status).toBe(422)
    expect(mocks.validateKey).not.toHaveBeenCalled()
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
    expect(mocks.saveStepfunModelSettings).not.toHaveBeenCalled()
  })

  it('applies apiKey and model settings together only after validation succeeds', async () => {
    mocks.validateKey.mockResolvedValue(true)
    const response = await POST(request({
      apiKey: 'sk-valid-value',
      baseUrl: 'https://api.stepfun.com/v1',
    }))

    expect(response.status).toBe(422)
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
    expect(mocks.saveStepfunModelSettings).not.toHaveBeenCalled()
  })

  it('does not save a validated key when a custom base URL is rejected', async () => {
    mocks.validateKey.mockResolvedValue(true)

    const response = await POST(request({
      apiKey: 'sk-valid-value',
      baseUrl: 'https://custom.example/v1',
    }))
    expect(response.status).toBe(422)
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

    expect(response.status).toBe(422)
    expect(mocks.validateGeminiKey).not.toHaveBeenCalled()
    expect(mocks.saveGeminiApiKey).not.toHaveBeenCalled()
    expect(mocks.saveGeminiSettings).not.toHaveBeenCalled()
    expect(mocks.saveDirectorRoutes).not.toHaveBeenCalled()
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
    const response = await POST(request({
      routes: { 'script-import': 'stepfun' },
    }))

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

  it('rejects lane quotas combined with a managed StepFun key', async () => {
    mocks.validateKey.mockResolvedValue(true)
    const response = await POST(request({
      apiKey: 'sk-valid',
      laneQuotas: { directorStageConcurrency: 4, renderShotConcurrency: 2 },
    }))

    expect(response.status).toBe(422)
    expect(mocks.saveApiKey).not.toHaveBeenCalled()
    expect(mocks.saveLaneQuotas).not.toHaveBeenCalled()
  })
})

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
