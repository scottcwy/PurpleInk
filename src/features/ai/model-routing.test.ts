import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiConfigDependencies } from './config'
import {
  describeDirectorRoutes,
  getDirectorProvider,
  resolveDirectorModelTarget,
  saveDirectorRoutes,
} from './model-routing'

vi.mock('server-only', () => ({}))

const originalEnv = { ...process.env }
type ModelKind = Parameters<AiConfigDependencies['modelRoutes']['find']>[1]
type MediaKind = Parameters<AiConfigDependencies['mediaRoutes']['find']>[1]
type ModelRoute = NonNullable<
  Awaited<ReturnType<AiConfigDependencies['modelRoutes']['find']>>
>
type MediaRoute = NonNullable<
  Awaited<ReturnType<AiConfigDependencies['mediaRoutes']['find']>>
>

function createDependencies() {
  const models = new Map<ModelKind, ModelRoute>()
  const media = new Map<MediaKind, MediaRoute>()
  const secrets = new Map<string, string>()
  const credentials: AiConfigDependencies['credentials'] = {
    save: vi.fn(async ({ provider, secret }) => {
      secrets.set(provider, secret)
    }),
    loadSecret: vi.fn(async (_workspaceId, provider) => secrets.get(provider) ?? null),
    describe: vi.fn(async () => ({
      configured: false,
      verifiedAt: null,
      updatedAt: null,
    })),
  }
  const modelRoutes: AiConfigDependencies['modelRoutes'] = {
    find: vi.fn(async (_workspaceId, kind) => models.get(kind) ?? null),
    save: vi.fn(async (input) => {
      const route = {
        ...input,
        revision: (models.get(input.aiTaskKind)?.revision ?? -1) + 1,
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
      const route = {
        ...input,
        revision: (media.get(input.mediaTaskKind)?.revision ?? -1) + 1,
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
    dependencies: { credentials, mediaRoutes, modelRoutes },
    media,
    models,
    secrets,
  }
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    GEMINI_API_KEY: 'gemini-key',
    STEPFUN_API_KEY: 'stepfun-key',
  }
})
afterEach(() => {
  process.env = originalEnv
})

describe('Director provider routing', () => {
  it('keeps the legacy default provider behavior', async () => {
    const { dependencies } = createDependencies()
    await expect(getDirectorProvider('script-import', dependencies))
      .resolves.toMatchObject({ provider: 'gemini' })
    await expect(getDirectorProvider('shot-codegen', dependencies))
      .resolves.toMatchObject({ provider: 'gemini' })
    await expect(getDirectorProvider('shot-sfx', dependencies))
      .resolves.toMatchObject({ provider: 'stepfun' })
  })

  it('persists node settings through the fixed AI/media route kinds', async () => {
    const { dependencies, media, models } = createDependencies()
    await saveDirectorRoutes({
      'shot-codegen': 'stepfun',
      'shot-sfx': 'gemini',
    }, dependencies)

    expect(models.get('fabricate')).toMatchObject({
      provider: 'stepfun',
      model: 'step-3.5-flash',
    })
    expect(media.get('tts')).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
    })
    await expect(getDirectorProvider('shot-codegen', dependencies))
      .resolves.toEqual({ provider: 'stepfun', source: 'settings' })
  })

  it('resolves configured model and secret through the shared credential store', async () => {
    const { dependencies, models, secrets } = createDependencies()
    secrets.set('stepfun', 'stored-stepfun-key')
    models.set('fabricate', {
      workspaceId: 'workspace',
      aiTaskKind: 'fabricate',
      provider: 'stepfun',
      model: 'stored-fabricate',
      revision: 0,
    })

    await expect(resolveDirectorModelTarget(
      'shot-codegen',
      'text',
      dependencies,
    )).resolves.toEqual({
      provider: 'stepfun',
      baseUrl: 'https://api.stepfun.com/v1',
      modelId: 'stored-fabricate',
      apiKey: 'stored-stepfun-key',
    })
    expect(dependencies.credentials.loadSecret).toHaveBeenCalledWith(
      expect.any(String),
      'stepfun',
    )
  })

  it('keeps Gemini fast/primary defaults and describes all visible routes', async () => {
    const { dependencies, secrets } = createDependencies()
    secrets.set('gemini', 'gemini-key')
    await expect(resolveDirectorModelTarget(
      'script-import',
      'text',
      dependencies,
    )).resolves.toMatchObject({
      provider: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      apiKey: 'gemini-key',
    })
    await expect(resolveDirectorModelTarget(
      'shot-qa',
      'vision',
      dependencies,
    )).resolves.toMatchObject({
      provider: 'gemini',
      modelId: 'gemini-3.6-flash',
    })

    const routes = await describeDirectorRoutes(dependencies)
    expect(Object.keys(routes)).toHaveLength(9)
    expect(routes['script-import']).toMatchObject({
      provider: 'gemini',
      source: 'default',
      model: 'gemini-3.1-flash-lite',
    })
  })
})
