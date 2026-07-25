import { describe, expect, it, vi } from 'vitest'

const getDb = vi.fn(() => {
  throw new Error('模块导入阶段不应访问数据库')
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({ getDb }))

describe('server module startup boundary', () => {
  it('imports Director and Render queue modules without opening SQLite', async () => {
    await expect(import('./queue-handler')).resolves.toBeDefined()
    await expect(import('@/features/render/queue-handler')).resolves.toBeDefined()
    expect(getDb).not.toHaveBeenCalled()
  }, 15_000)
})
