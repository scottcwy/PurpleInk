import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiConfigDependencies } from './config'
import {
  describeGeminiConfig,
  getGeminiConfig,
  saveGeminiApiKey,
  saveGeminiSettings,
} from './gemini-config'

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
    'CVC_MANAGED_GEMINI_API_KEY',
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
      primaryModel: 'gemini-3.1-flash-lite',
      fastModel: 'gemini-3.1-flash-lite',
    })
  })

  it('uses the managed credential and ignores workspace routes and legacy env', async () => {
    const { dependencies, models, secrets } = createDependencies()
    process.env.GEMINI_API_KEY = 'env-key'
    process.env.CVC_MANAGED_GEMINI_API_KEY = 'managed-key'
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
      apiKey: 'managed-key',
      primaryModel: 'gemini-3.1-flash-lite',
      fastModel: 'gemini-3.1-flash-lite',
    })
    const view = await describeGeminiConfig(dependencies)
    expect(view.primaryModel).toEqual({
      value: 'gemini-3.1-flash-lite',
      source: 'default',
    })
    expect(view).not.toHaveProperty('apiKey')
    expect(JSON.stringify(view)).not.toContain('stored-key')
    expect(dependencies.credentials.loadSecret).not.toHaveBeenCalled()
  })

  it('rejects managed model writes but stores workspace BYOK credentials', async () => {
    const { dependencies, models, secrets } = createDependencies()
    await expect(saveGeminiSettings({
      primaryModel: 'custom-primary',
      fastModel: 'custom-fast',
    }, dependencies)).rejects.toThrow('托管模型')
    expect(models.size).toBe(0)
    await expect(saveGeminiApiKey(
      'gemini-secret',
      new Date('2026-07-25T00:00:00.000Z'),
      dependencies,
    )).resolves.toBeUndefined()
    expect(secrets.get('gemini')).toBe('gemini-secret')
    expect(dependencies.credentials.save).toHaveBeenCalledWith({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      provider: 'gemini',
      secret: 'gemini-secret',
      verifiedAt: new Date('2026-07-25T00:00:00.000Z'),
    })
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
