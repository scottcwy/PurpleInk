import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const store = globalThis as Record<string, unknown>

function clearAnchors(): void {
  delete store.__cvcQueue
  delete store.__cvcQueueInitialized
  delete store.__cvcQueueInitializing
}

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
    const first = await import('./index')
    vi.resetModules()
    const second = await import('./index')

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
