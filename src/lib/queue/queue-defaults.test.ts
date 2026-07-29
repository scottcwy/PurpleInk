import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const availableParallelism = vi.hoisted(() => vi.fn<() => number>())

vi.mock('node:os', () => ({
  default: {
    availableParallelism,
    cpus: vi.fn(() => []),
  },
}))

describe('defaultRenderShotConcurrency', () => {
  afterEach(() => {
    availableParallelism.mockReset()
  })

  it('用 os.availableParallelism() 推导并 clamp 到 1..8', async () => {
    const { defaultRenderShotConcurrency } = await import('./queue-defaults')

    availableParallelism.mockReturnValue(32)
    expect(defaultRenderShotConcurrency()).toBe(8)

    availableParallelism.mockReturnValue(6)
    expect(defaultRenderShotConcurrency()).toBe(6)

    availableParallelism.mockReturnValue(1)
    expect(defaultRenderShotConcurrency()).toBe(1)

    // 容器 cgroup 限额下可能出现 0/异常小值，仍保底 1。
    availableParallelism.mockReturnValue(0)
    expect(defaultRenderShotConcurrency()).toBe(1)
  })
})
