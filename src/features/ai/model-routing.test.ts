import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiConfigDependencies } from './config'
import {
  DIRECTOR_NODE_TYPES,
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
  let customProfile: { baseUrl: string; defaultModel: string } | null = null
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
    dependencies: {
      credentials,
      mediaRoutes,
      modelRoutes,
      openAiCompatibleProfiles: {
        find: vi.fn(async () => customProfile),
        save: vi.fn(async (_workspaceId, profile) => {
          customProfile = profile
        }),
      },
    },
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

  it('persists AI and capability-compatible media routes', async () => {
    const { dependencies, media, models } = createDependencies()
    await saveDirectorRoutes({
      'shot-codegen': 'stepfun',
      'shot-sfx': 'mimo',
      'shot-subtitle': 'mimo',
    }, dependencies)

    expect(models.get('fabricate')).toMatchObject({
      provider: 'stepfun',
      model: 'step-3.5-flash',
    })
    expect(media.get('tts')).toMatchObject({
      provider: 'mimo',
      model: 'mimo-v2.5-tts',
    })
    expect(media.get('asr')).toMatchObject({
      provider: 'mimo',
      model: 'mimo-v2.5-asr',
    })
    await expect(getDirectorProvider('shot-codegen', dependencies))
      .resolves.toEqual({ provider: 'stepfun', source: 'settings' })
  })

  it('rejects providers that do not own the selected node capability', async () => {
    const { dependencies } = createDependencies()
    await expect(saveDirectorRoutes({
      'shot-sfx': 'gemini',
    }, dependencies)).rejects.toThrow('不支持 TTS')
  })

  it('resolves every route contract before persisting any route', async () => {
    const { dependencies } = createDependencies()

    await expect(saveDirectorRoutes({
      'shot-codegen': 'stepfun',
      export: 'openai-compatible',
    }, dependencies)).rejects.toThrow('尚未配置')

    expect(dependencies.modelRoutes.save).not.toHaveBeenCalled()
    expect(dependencies.mediaRoutes.save).not.toHaveBeenCalled()
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

  it('resolves a custom OpenAI-compatible route with its endpoint and route model', async () => {
    const { dependencies, models, secrets } = createDependencies()
    secrets.set('openai-compatible', 'custom-key')
    await dependencies.openAiCompatibleProfiles!.save('workspace', {
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      defaultModel: 'mimo-v2.5-pro',
    })
    models.set('project-plan', {
      workspaceId: 'workspace',
      aiTaskKind: 'project-plan',
      provider: 'openai-compatible',
      model: 'mimo-v2.5-pro',
      revision: 0,
    })

    await expect(resolveDirectorModelTarget(
      'script-import',
      'text',
      dependencies,
    )).resolves.toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      modelId: 'mimo-v2.5-pro',
      apiKey: 'custom-key',
    })
  })

  it('resolves MiMo as an independent built-in provider', async () => {
    const { dependencies, models, secrets } = createDependencies()
    secrets.set('mimo', 'stored-mimo-key')
    models.set('fabricate', {
      workspaceId: 'workspace',
      aiTaskKind: 'fabricate',
      provider: 'mimo',
      model: 'mimo-v2.5',
      revision: 0,
    })

    await expect(resolveDirectorModelTarget(
      'shot-codegen',
      'text',
      dependencies,
    )).resolves.toEqual({
      provider: 'mimo',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      modelId: 'mimo-v2.5',
      apiKey: 'stored-mimo-key',
    })
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

  /**
   * 真实事故回归：`shot-sfx` / `shot-subtitle` 同时有两个职责——Director 会话用
   * 文本模型产出音效清单与字幕规划（历史上 77 个节点成功并留下 director-assemble
   * 产物），媒体路由只覆盖真实 TTS / ASR 调用。曾经因为「媒体域节点直接抛错」
   * 让整条音效与字幕通道全线失败，而测试完全没有覆盖。
   */
  it('resolves a Director session model for every director node type', async () => {
    const { dependencies, secrets } = createDependencies()
    secrets.set('gemini', 'gemini-key')
    for (const nodeType of DIRECTOR_NODE_TYPES) {
      await expect(
        resolveDirectorModelTarget(nodeType, 'text', dependencies),
        `${nodeType} 必须能解析出 Director 会话模型`
      ).resolves.toMatchObject({ modelId: expect.any(String) })
    }
  })

  it('binds a media lane session to the text route, not to the TTS/ASR route', async () => {
    const { dependencies, media, models, secrets } = createDependencies()
    secrets.set('gemini', 'gemini-key')
    secrets.set('mimo', 'mimo-key')
    models.set('project-plan', {
      workspaceId: 'workspace',
      aiTaskKind: 'project-plan',
      provider: 'gemini',
      model: 'configured-text-model',
      revision: 0,
    })
    media.set('tts', {
      workspaceId: 'workspace',
      mediaTaskKind: 'tts',
      provider: 'mimo',
      model: 'mimo-v2.5-tts',
      revision: 0,
    })

    // 会话拿文本路由；媒体路由仍然只服务真实 TTS 调用与设置页展示。
    await expect(
      resolveDirectorModelTarget('shot-sfx', 'text', dependencies)
    ).resolves.toMatchObject({
      provider: 'gemini',
      modelId: 'configured-text-model',
      apiKey: 'gemini-key',
    })
    const routes = await describeDirectorRoutes(dependencies)
    expect(routes['shot-sfx']).toMatchObject({
      provider: 'mimo',
      source: 'settings',
      model: 'mimo-v2.5-tts',
    })
  })

  /**
   * 设置页展示值与实际执行值必须来自同一处默认值推导。曾经 describeDirectorRoutes
   * 按任务种类给 project-plan 返回 fastModel，而执行路径按节点类型给非
   * script-import 的 project-plan 节点返回 primaryModel：设置页显示一个模型，
   * 真跑另一个模型。
   */
  it('keeps the displayed default model identical to the executed one', async () => {
    const { dependencies, secrets } = createDependencies()
    secrets.set('gemini', 'gemini-key')
    const routes = await describeDirectorRoutes(dependencies)
    for (const nodeType of ['script-import', 'shot-split', 'score', 'export', 'shot-script', 'shot-codegen'] as const) {
      const executed = await resolveDirectorModelTarget(nodeType, 'text', dependencies)
      expect(routes[nodeType]?.model, `${nodeType} 展示值必须等于执行值`).toBe(
        executed.modelId
      )
    }
  })
})
