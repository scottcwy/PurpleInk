import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const store = globalThis as Record<string, unknown>

function clearAnchors(): void {
  delete store.__cvcQueue
  delete store.__cvcQueueInitialized
  delete store.__cvcQueueInitializing
}

describe('initQueue 模块边界', () => {
  beforeEach(() => {
    clearAnchors()
    vi.resetModules()
  })

  afterEach(() => {
    clearAnchors()
    vi.resetModules()
    vi.doUnmock('./runtime-config')
  })

  it('导入启动入口时不加载运行时 DB 配额模块', async () => {
    vi.doMock('./runtime-config', () => {
      throw new Error('导入 init.ts 时不应加载 runtime-config')
    })

    await expect(import('./init')).resolves.toBeDefined()
  })
})

describe('queue 单例与 initQueue 的 globalThis 锚定', () => {
  beforeEach(() => {
    clearAnchors()
    vi.resetModules()
  })

  afterEach(() => {
    clearAnchors()
    vi.resetModules()
  })

  it('queue 单例锚定 globalThis：模块重求值后仍是同一实例', async () => {
    const first = await import('./singleton')
    vi.resetModules()
    const second = await import('./singleton')

    // 裸模块单例会在重求值时得到新实例；globalThis 锚定后跨模块图共享同一队列。
    expect(second.queue).toBe(first.queue)
  })

  it('initQueue 幂等：initialized 标志锚定 globalThis，跨模块重求值共享', async () => {
    const first = await import('./init')
    await first.initQueue() // 测试环境短路：置 globalThis.__cvcQueueInitialized = true
    expect(store.__cvcQueueInitialized).toBe(true)

    vi.resetModules()
    const second = await import('./init')
    // 新模块实例读到 globalThis 已初始化标志，再次调用直接返回（不重复注册 / start）。
    await expect(second.initQueue()).resolves.toBeUndefined()
    expect(store.__cvcQueueInitialized).toBe(true)
  })
})

describe('initQueue 失败可重试', () => {
  beforeEach(() => {
    clearAnchors()
    vi.resetModules()
  })

  afterEach(() => {
    clearAnchors()
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.doUnmock('./runtime-config')
    vi.doUnmock('./singleton')
    vi.doUnmock('@/features/director/queue-handler')
    vi.doUnmock('@/features/render/queue-handler')
    vi.doUnmock('@/features/render/export-queue-handler')
    vi.doUnmock('@/features/audio/narration-queue-handler')
    vi.doUnmock('@/features/audio/audio-transcription-queue-handler')
    vi.doUnmock('@/features/website/website-queue-handler')
  })

  it('首次启动失败不缓存 rejected promise，第二次调用可重试成功', async () => {
    const loadLaneQuotasForStart = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB 未就绪'))
      .mockResolvedValueOnce({})
    const start = vi.fn()
    const registerAudioTranscriptionHandler = vi.fn()
    const registerWebsiteVideoHandler = vi.fn()
    vi.doMock('./runtime-config', () => ({ loadLaneQuotasForStart }))
    vi.doMock('./singleton', () => ({
      queue: { start },
    }))
    vi.doMock('@/features/director/queue-handler', () => ({
      registerDirectorStageHandler: vi.fn(),
    }))
    vi.doMock('@/features/render/queue-handler', () => ({
      registerRenderShotHandler: vi.fn(),
    }))
    vi.doMock('@/features/render/export-queue-handler', () => ({
      registerExportProjectHandler: vi.fn(),
    }))
    vi.doMock('@/features/audio/narration-queue-handler', () => ({
      registerMediaNarrationHandler: vi.fn(),
    }))
    vi.doMock('@/features/audio/audio-transcription-queue-handler', () => ({
      registerAudioTranscriptionHandler,
    }))
    vi.doMock('@/features/website/website-queue-handler', () => ({
      registerWebsiteVideoHandler,
    }))
    // 绕过测试环境短路，走真实启动路径（instrumentation 首跑失败 -> API 路由兜底重试的场景）。
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VITEST', '')

    const { initQueue } = await import('./init')

    await expect(initQueue()).rejects.toThrow('DB 未就绪')
    expect(store.__cvcQueueInitialized).toBeUndefined()
    expect(store.__cvcQueueInitializing).toBeNull()

    await expect(initQueue()).resolves.toBeUndefined()
    expect(store.__cvcQueueInitialized).toBe(true)
    expect(loadLaneQuotasForStart).toHaveBeenCalledTimes(2)
    expect(registerAudioTranscriptionHandler).toHaveBeenCalledOnce()
    expect(registerWebsiteVideoHandler).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
  })
})

describe('resolveLaneQuotas', () => {
  beforeEach(() => {
    clearAnchors()
    vi.resetModules()
  })

  afterEach(() => {
    clearAnchors()
    vi.resetModules()
  })

  it('returns no overrides when env vars are unset or blank', async () => {
    const { resolveLaneQuotas } = await import('./lane-quota-env')
    expect(resolveLaneQuotas({})).toEqual({})
    expect(
      resolveLaneQuotas({
        CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '',
        CVC_QUEUE_RENDER_SHOT_CONCURRENCY: '   ',
      })
    ).toEqual({})
  })

  it('parses valid env overrides for known lanes', async () => {
    const { resolveLaneQuotas } = await import('./lane-quota-env')
    expect(
      resolveLaneQuotas({
        CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '4',
        CVC_QUEUE_RENDER_SHOT_CONCURRENCY: '2',
      })
    ).toEqual({ 'director-stage': 4, 'render-shot': 2 })
  })

  it('rejects zero, negative, non-integer, and non-numeric overrides', async () => {
    const { resolveLaneQuotas } = await import('./lane-quota-env')
    expect(() =>
      resolveLaneQuotas({ CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '0' })
    ).toThrow()
    expect(() =>
      resolveLaneQuotas({ CVC_QUEUE_RENDER_SHOT_CONCURRENCY: '-1' })
    ).toThrow()
    expect(() =>
      resolveLaneQuotas({ CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '1.5' })
    ).toThrow()
    expect(() =>
      resolveLaneQuotas({ CVC_QUEUE_RENDER_SHOT_CONCURRENCY: 'abc' })
    ).toThrow()
  })
})
