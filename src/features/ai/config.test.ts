import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AiConfigDependencies,
  describeStepfunConfig,
  getStepfunConfig,
  saveStepfunModelSettings,
} from './config'

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

  it('uses model env values but never falls back to a plaintext credential env', async () => {
    const { dependencies } = createDependencies()
    process.env.STEPFUN_API_KEY = 'env-key'
    process.env.STEPFUN_CHAT_MODEL = 'env-chat'
    process.env.STEPFUN_TTS_MODEL = 'env-tts'

    await expect(getStepfunConfig(dependencies)).resolves.toMatchObject({
      apiKey: null,
      chatModel: 'env-chat',
      ttsModel: 'env-tts',
    })
  })

  it('prefers encrypted credentials and provider-matched routes over env', async () => {
    const { dependencies, media, models, secrets } = createDependencies()
    process.env.STEPFUN_API_KEY = 'env-key'
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
      apiKey: 'stored-key',
      chatModel: 'stored-chat',
      ttsModel: 'stored-tts',
      visionModel: 'stored-vision',
    })
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

    expect(view.chatModel).toEqual({ value: 'custom-chat', source: 'settings' })
    expect(view.asrModel).toEqual({ value: 'env-asr', source: 'env' })
    expect(view).not.toHaveProperty('apiKey')
    expect(JSON.stringify(view)).not.toContain('never-exposed')
  })
})

describe('saveStepfunModelSettings', () => {
  it('writes only submitted model groups and clears empty overrides', async () => {
    const { dependencies, media, models } = createDependencies()
    media.set('tts', {
      workspaceId: 'workspace',
      mediaTaskKind: 'tts',
      provider: 'stepfun',
      model: 'existing-tts',
      revision: 0,
    })

    await saveStepfunModelSettings({ chatModel: 'new-chat' }, dependencies)
    expect([...models.keys()].sort()).toEqual(
      ['fabricate', 'project-plan', 'shot-spec'].sort(),
    )
    expect(media.get('tts')?.model).toBe('existing-tts')

    await saveStepfunModelSettings({ chatModel: '' }, dependencies)
    expect(models.size).toBe(0)
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
