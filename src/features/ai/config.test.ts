import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AiConfigDependencies,
  describeStepfunConfig,
  getStepfunConfig,
  saveStepfunModelSettings,
} from './config'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

vi.mock('server-only', () => ({}))

const originalEnv = { ...process.env }
type ModelKind = Parameters<AiConfigDependencies['modelRoutes']['find']>[1]
type MediaKind = Parameters<AiConfigDependencies['mediaRoutes']['find']>[1]
type ModelRoute = Awaited<
  ReturnType<AiConfigDependencies['modelRoutes']['find']>
>
type MediaRoute = Awaited<
  ReturnType<AiConfigDependencies['mediaRoutes']['find']>
>

function createDependencies() {
  const models = new Map<ModelKind, NonNullable<ModelRoute>>()
  const media = new Map<MediaKind, NonNullable<MediaRoute>>()
  const secrets = new Map<string, string>()
  const credentials: AiConfigDependencies['credentials'] = {
    save: vi.fn(async ({ provider, secret }) => {
      secrets.set(provider, secret)
    }),
    loadSecret: vi.fn(async (_workspaceId, provider) => secrets.get(provider) ?? null),
    describe: vi.fn(async (_workspaceId, provider) => ({
      configured: secrets.has(provider),
      verifiedAt: null,
      updatedAt: null,
    })),
  }
  const modelRoutes: AiConfigDependencies['modelRoutes'] = {
    find: vi.fn(async (_workspaceId, kind) => models.get(kind) ?? null),
    save: vi.fn(async (input) => {
      const previous = models.get(input.aiTaskKind)
      const route = {
        ...input,
        revision: previous ? previous.revision + 1 : 0,
      }
      models.set(input.aiTaskKind, route)
      return route
    }),
    remove: vi.fn(async (_workspaceId, kind) => models.delete(kind)),
    resolve: vi.fn(async (workspaceId, kind) => {
      const route = models.get(kind)
      return route
        ? {
            ...route,
            secret: await credentials.loadSecret(workspaceId, route.provider),
          }
        : null
    }),
  }
  const mediaRoutes: AiConfigDependencies['mediaRoutes'] = {
    find: vi.fn(async (_workspaceId, kind) => media.get(kind) ?? null),
    save: vi.fn(async (input) => {
      const previous = media.get(input.mediaTaskKind)
      const route = {
        ...input,
        revision: previous ? previous.revision + 1 : 0,
      }
      media.set(input.mediaTaskKind, route)
      return route
    }),
    remove: vi.fn(async (_workspaceId, kind) => media.delete(kind)),
    resolve: vi.fn(async (workspaceId, kind) => {
      const route = media.get(kind)
      return route
        ? {
            ...route,
            secret: await credentials.loadSecret(workspaceId, route.provider),
          }
        : null
    }),
  }
  return {
    dependencies: { credentials, modelRoutes, mediaRoutes },
    media,
    models,
    secrets,
  }
}

beforeEach(() => {
  process.env = { ...originalEnv }
  for (const key of [
    'STEPFUN_API_KEY',
    'CVC_MANAGED_STEPFUN_API_KEY',
    'STEPFUN_BASE_URL',
    'STEPFUN_CHAT_MODEL',
    'STEPFUN_TTS_MODEL',
    'STEPFUN_ASR_MODEL',
    'STEPFUN_VISION_MODEL',
  ]) {
    delete process.env[key]
  }
})
afterEach(() => {
  process.env = originalEnv
})

describe('getStepfunConfig', () => {
  it('falls back to canonical defaults without opening storage at import time', async () => {
    const { dependencies } = createDependencies()

    await expect(getStepfunConfig(dependencies)).resolves.toEqual({
      apiKey: null,
      baseUrl: 'https://api.stepfun.com/v1',
      chatModel: 'step-3.5-flash',
      ttsModel: 'stepaudio-2.5-tts',
      asrModel: 'stepaudio-2.5-asr',
      visionModel: 'step-3.7-flash',
    })
  })

  it('uses only the managed credential env and fixed catalog models', async () => {
    const { dependencies } = createDependencies()
    process.env.STEPFUN_API_KEY = 'env-key'
    process.env.CVC_MANAGED_STEPFUN_API_KEY = 'managed-key'
    process.env.STEPFUN_CHAT_MODEL = 'env-chat'
    process.env.STEPFUN_TTS_MODEL = 'env-tts'

    await expect(getStepfunConfig(dependencies)).resolves.toMatchObject({
      apiKey: 'managed-key',
      chatModel: 'step-3.5-flash',
      ttsModel: 'stepaudio-2.5-tts',
    })
  })

  it('ignores encrypted workspace credentials and arbitrary stored routes', async () => {
    const { dependencies, media, models, secrets } = createDependencies()
    process.env.STEPFUN_API_KEY = 'env-key'
    process.env.CVC_MANAGED_STEPFUN_API_KEY = 'managed-key'
    process.env.STEPFUN_CHAT_MODEL = 'env-chat'
    secrets.set('stepfun', 'stored-key')
    models.set('fabricate', {
      workspaceId: 'workspace',
      aiTaskKind: 'fabricate',
      provider: 'stepfun',
      model: 'stored-chat',
      revision: 0,
    })
    models.set('vision-qa', {
      workspaceId: 'workspace',
      aiTaskKind: 'vision-qa',
      provider: 'stepfun',
      model: 'stored-vision',
      revision: 0,
    })
    media.set('tts', {
      workspaceId: 'workspace',
      mediaTaskKind: 'tts',
      provider: 'stepfun',
      model: 'stored-tts',
      revision: 0,
    })

    await expect(getStepfunConfig(dependencies)).resolves.toMatchObject({
      apiKey: 'managed-key',
      chatModel: 'step-3.5-flash',
      ttsModel: 'stepaudio-2.5-tts',
      visionModel: 'step-3.7-flash',
    })
    expect(dependencies.credentials.loadSecret).not.toHaveBeenCalled()
  })
})

describe('describeStepfunConfig', () => {
  it('returns only model/endpoint views and never credential material', async () => {
    const { dependencies, models, secrets } = createDependencies()
    secrets.set('stepfun', 'never-exposed')
    models.set('fabricate', {
      workspaceId: 'workspace',
      aiTaskKind: 'fabricate',
      provider: 'stepfun',
      model: 'custom-chat',
      revision: 0,
    })
    process.env.STEPFUN_ASR_MODEL = 'env-asr'

    const view = await describeStepfunConfig(dependencies)

    expect(view.chatModel).toEqual({ value: 'step-3.5-flash', source: 'default' })
    expect(view.asrModel).toEqual({ value: 'stepaudio-2.5-asr', source: 'default' })
    expect(view).not.toHaveProperty('apiKey')
    expect(JSON.stringify(view)).not.toContain('never-exposed')
  })
})

describe('saveStepfunModelSettings', () => {
  it('rejects all managed model writes without mutating routes', async () => {
    const { dependencies, media, models } = createDependencies()
    media.set('tts', {
      workspaceId: 'workspace',
      mediaTaskKind: 'tts',
      provider: 'stepfun',
      model: 'existing-tts',
      revision: 0,
    })

    await expect(saveStepfunModelSettings(
      { chatModel: 'new-chat' },
      dependencies,
    )).rejects.toThrow('托管模型')
    expect(models.size).toBe(0)
    expect(media.get('tts')?.model).toBe('existing-tts')
  })

  it('accepts empty/canonical base URLs but rejects unsupported persistence', async () => {
    const { dependencies } = createDependencies()
    await expect(saveStepfunModelSettings({
      baseUrl: 'https://api.stepfun.com/v1',
    }, dependencies)).resolves.toBeUndefined()
    await expect(saveStepfunModelSettings({
      baseUrl: '',
    }, dependencies)).resolves.toBeUndefined()
    await expect(saveStepfunModelSettings({
      baseUrl: 'https://custom.example/v1',
    }, dependencies)).rejects.toThrow('custom StepFun baseUrl')
  })
})
