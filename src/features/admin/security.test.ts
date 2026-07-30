import { describe, expect, it, vi } from 'vitest'

// aggregateThrottle 是纯函数，但 security.ts 顶层 import 了 server-only 与 db client；
// 单测里把两者打桩，避免连库副作用。
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }))

const { aggregateThrottle } = await import('./security')

const now = Date.now()

function row(key: string, count: number, ageMs: number) {
  return { key, count, windowStartedAt: new Date(now - ageMs) }
}

describe('aggregateThrottle', () => {
  it('只统计仍在各自窗口内的活跃 key，并标出达/超阈值项', () => {
    const signals = aggregateThrottle([
      // codeByIp 限 10/小时：一个达阈值、一个未达，均在窗口内。
      row('ip:aaaa:codeByIp', 10, 5 * 60_000),
      row('ip:bbbb:codeByIp', 3, 5 * 60_000),
      // loginFailureByIp 限 30/15 分钟：窗口已过（20 分钟前），不计入。
      row('ip:cccc:loginFailureByIp', 40, 20 * 60_000),
      // loginFailureByEmail 限 10/15 分钟：活跃但未达阈值。
      row('email:dddd:loginFailureByEmail', 5, 60_000),
    ])

    const byRule = new Map(signals.map((signal) => [signal.rule, signal]))

    expect(byRule.get('codeByIp')).toMatchObject({
      activeKeys: 2,
      atOrOverLimit: 1,
      maxCount: 10,
      limit: 10,
    })
    expect(byRule.get('loginFailureByIp')).toMatchObject({
      activeKeys: 0,
      atOrOverLimit: 0,
      maxCount: 0,
    })
    expect(byRule.get('loginFailureByEmail')).toMatchObject({
      activeKeys: 1,
      atOrOverLimit: 0,
      maxCount: 5,
    })
  })

  it('对每条规则都返回一项（含零值规则），且带展示标签', () => {
    const signals = aggregateThrottle([])
    expect(signals).toHaveLength(5)
    for (const signal of signals) {
      expect(signal.label.length).toBeGreaterThan(0)
      expect(signal.activeKeys).toBe(0)
    }
  })

  it('忽略无法解析出规则名的 key', () => {
    const signals = aggregateThrottle([
      row('malformed-key-without-rule', 99, 1_000),
      row('ip:eeee:unknownRule', 99, 1_000),
    ])
    expect(signals.every((signal) => signal.activeKeys === 0)).toBe(true)
  })
})
