import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConfigDependencies } from './config'
import {
  describeMimoConfig,
  getMimoConfig,
  saveMimoSettings,
} from './mimo-config'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

vi.mock('server-only', () => ({}))

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

function dependencies() {
  const models = new Map<string, {
    provider: string
    model: string
    revision: number
    workspaceId: string
    aiTaskKind: never
  }>()
  const media = new Map<string, {
    provider: string
    model: string
    revision: number
    workspaceId: string
    mediaTaskKind: never
  }>()
  const credentials: AiConfigDependencies['credentials'] = {
    save: vi.fn(async () => undefined),
    loadSecret: vi.fn(async () => 'stored-mimo-key'),
    describe: vi.fn(async () => ({
      configured: true,
      verifiedAt: null,
      updatedAt: null,
    })),
  }
  const modelRoutes = {
    find: vi.fn(async (_workspaceId: string, kind: string) =>
      models.get(kind) ?? null),
    resolve: vi.fn(),
    remove: vi.fn(async (_workspaceId: string, kind: string) =>
      models.delete(kind)),
    save: vi.fn(async (input: {
      workspaceId: string
      aiTaskKind: string
      provider: string
      model: string
    }) => {
      const route = { ...input, revision: 0 }
      models.set(input.aiTaskKind, route as never)
      return route
    }),
  } as unknown as AiConfigDependencies['modelRoutes']
  const mediaRoutes = {
    find: vi.fn(async (_workspaceId: string, kind: string) =>
      media.get(kind) ?? null),
    resolve: vi.fn(),
    remove: vi.fn(async (_workspaceId: string, kind: string) =>
      media.delete(kind)),
    save: vi.fn(async (input: {
      workspaceId: string
      mediaTaskKind: string
      provider: string
      model: string
    }) => {
      const route = { ...input, revision: 0 }
      media.set(input.mediaTaskKind, route as never)
      return route
    }),
  } as unknown as AiConfigDependencies['mediaRoutes']
  return {
    deps: { credentials, modelRoutes, mediaRoutes } as AiConfigDependencies,
    models,
    media,
  }
}

describe('MiMo configuration', () => {
  it('uses only the managed credential with fixed catalog defaults', async () => {
    const { deps } = dependencies()
    process.env.MIMO_BASE_URL = ''
    process.env.MIMO_API_KEY = 'must-not-be-read'
    process.env.CVC_MANAGED_MIMO_API_KEY = 'managed-mimo-key'

    await expect(getMimoConfig(deps)).resolves.toEqual({
      apiKey: 'managed-mimo-key',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      textModel: 'mimo-v2.5',
      visionModel: 'mimo-v2.5',
      ttsModel: 'mimo-v2.5-tts',
      asrModel: 'mimo-v2.5-asr',
    })
    expect(deps.credentials.loadSecret).not.toHaveBeenCalled()
  })

  it('rejects arbitrary managed model writes', async () => {
    const { deps, models, media } = dependencies()
    await expect(saveMimoSettings({
      textModel: 'mimo-v2.5',
      visionModel: 'mimo-v2.5',
      ttsModel: 'mimo-v2.5-tts-voicedesign',
      asrModel: 'mimo-v2.5-asr',
    }, deps)).rejects.toThrow('托管模型')
    expect(models.size).toBe(0)
    expect(media.size).toBe(0)
    await expect(describeMimoConfig(deps)).resolves.toMatchObject({
      ttsModel: { value: 'mimo-v2.5-tts', source: 'default' },
    })
  })
})
