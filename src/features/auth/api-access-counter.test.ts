import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({ getDb: mocks.getDb }))

import { classifyApiAccessOutcome, recordApiAccess } from './api-access-counter'

afterEach(() => vi.restoreAllMocks())

describe('API access outcome', () => {
  it.each([
    [200, '2xx'],
    [302, '2xx'],
    [400, '4xx'],
    [401, '401'],
    [404, '404'],
    [429, '4xx'],
    [500, '5xx'],
  ] as const)('classifies %s as %s', (status, expected) => {
    expect(classifyApiAccessOutcome(status)).toBe(expected)
  })

  it('swallows database failures and emits only a safe category log', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.getDb.mockRejectedValue(new Error('secret database detail'))

    await expect(recordApiAccess('projects', 200)).resolves.toBeUndefined()

    expect(warning).toHaveBeenCalledWith('[auth] API 访问计数失败')
  })
})
