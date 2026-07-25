import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiConfigDependencies } from './config'
import {
  describeGeminiConfig,
  getGeminiConfig,
  saveGeminiApiKey,
  saveGeminiSettings,
} from './gemini-config'

vi.mock('server-only', () => ({}))

const originalEnv = { ...process.env }
type ModelKind = Parameters<AiConfigDependencies['modelRoutes']['find']>[1]
type ModelRoute = NonNullable<
  Awaited<ReturnType<AiConfigDependencies['modelRoutes']['find']>>
>

function createDependencies() {
  const models = new Map<ModelKind, ModelRoute>()
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
    find: vi.fn(async () => null),
    save: vi.fn(),
    remove: vi.fn(async () => false),
    resolve: vi.fn(async () => null),
  }
  return {
    dependencies: { credentials, mediaRoutes, modelRoutes },
    models,
    secrets,
  }
}

beforeEach(() => {
  process.env = { ...originalEnv }
  for (const key of [
    'GEMINI_API_KEY',
    'GEMINI_BASE_URL',
    'GEMINI_PRIMARY_MODEL',
    'GEMINI_FAST_MODEL',
  ]) {
    delete process.env[key]
  }
})
afterEach(() => {
  process.env = originalEnv
})

describe('Gemini config', () => {
  it('uses the official endpoint and canonical model defaults', async () => {
    const { dependencies } = createDependencies()

    await expect(getGeminiConfig(dependencies)).resolves.toEqual({
      apiKey: null,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      primaryModel: 'gemini-3.6-flash',
      fastModel: 'gemini-3.1-flash-lite',
    })
  })

  it('resolves encrypted credential/routes over env without exposing the key', async () => {
    const { dependencies, models, secrets } = createDependencies()
    process.env.GEMINI_API_KEY = 'env-key'
    process.env.GEMINI_FAST_MODEL = 'env-fast'
    secrets.set('gemini', 'stored-key')
    models.set('fabricate', {
      workspaceId: 'workspace',
      aiTaskKind: 'fabricate',
      provider: 'gemini',
      model: 'stored-primary',
      revision: 0,
    })

    await expect(getGeminiConfig(dependencies)).resolves.toMatchObject({
      apiKey: 'stored-key',
      primaryModel: 'stored-primary',
      fastModel: 'env-fast',
    })
    const view = await describeGeminiConfig(dependencies)
    expect(view.primaryModel).toEqual({
      value: 'stored-primary',
      source: 'settings',
    })
    expect(view).not.toHaveProperty('apiKey')
    expect(JSON.stringify(view)).not.toContain('stored-key')
  })

  it('saves model groups, clears empty overrides, and persists keys via the store', async () => {
    const { dependencies, models, secrets } = createDependencies()
    await saveGeminiSettings({
      primaryModel: 'custom-primary',
      fastModel: 'custom-fast',
    }, dependencies)
    expect(models.get('project-plan')?.model).toBe('custom-fast')
    for (const kind of ['shot-spec', 'fabricate', 'vision-qa'] as const) {
      expect(models.get(kind)?.model).toBe('custom-primary')
    }

    await saveGeminiSettings({ fastModel: '' }, dependencies)
    expect(models.has('project-plan')).toBe(false)
    await saveGeminiApiKey(
      'gemini-secret',
      new Date('2026-07-25T00:00:00.000Z'),
      dependencies,
    )
    expect(secrets.get('gemini')).toBe('gemini-secret')
    expect(dependencies.credentials.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        verifiedAt: new Date('2026-07-25T00:00:00.000Z'),
      }),
    )
  })

  it('accepts canonical base URL but rejects custom persistence', async () => {
    const { dependencies } = createDependencies()
    await expect(saveGeminiSettings({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    }, dependencies)).resolves.toBeUndefined()
    await expect(saveGeminiSettings({
      baseUrl: 'https://custom.example/openai/',
    }, dependencies)).rejects.toThrow('custom Gemini baseUrl')
  })
})
