import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isProviderAvailable,
  recordProviderFailure,
  recordProviderSuccess,
  resetBreaker,
} from './provider-breaker'

vi.mock('server-only', () => ({}))

/** 打开某个 provider 的熔断：三次连续失败。 */
function tripBreaker(providerId: string): void {
  recordProviderFailure(providerId)
  recordProviderFailure(providerId)
  recordProviderFailure(providerId)
}

describe('provider breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetBreaker()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetBreaker()
  })

  it('stays closed below the consecutive-failure threshold', () => {
    recordProviderFailure('gemini')
    recordProviderFailure('gemini')
    expect(isProviderAvailable('gemini')).toBe(true)
  })

  it('opens after three consecutive failures and stays open within five minutes', () => {
    tripBreaker('gemini')
    expect(isProviderAvailable('gemini')).toBe(false)
    vi.advanceTimersByTime(5 * 60_000 - 1)
    expect(isProviderAvailable('gemini')).toBe(false)
  })

  it('resets the consecutive counter on success', () => {
    recordProviderFailure('gemini')
    recordProviderFailure('gemini')
    recordProviderSuccess('gemini')
    recordProviderFailure('gemini')
    recordProviderFailure('gemini')
    expect(isProviderAvailable('gemini')).toBe(true)
  })

  it('counts each provider independently', () => {
    tripBreaker('gemini')
    expect(isProviderAvailable('gemini')).toBe(false)
    expect(isProviderAvailable('stepfun')).toBe(true)
  })

  it('grants exactly one half-open probe after the open window elapses', () => {
    tripBreaker('gemini')
    vi.advanceTimersByTime(5 * 60_000)
    expect(isProviderAvailable('gemini')).toBe(true)
    expect(isProviderAvailable('gemini')).toBe(false)
  })

  it('closes on a successful probe', () => {
    tripBreaker('gemini')
    vi.advanceTimersByTime(5 * 60_000)
    expect(isProviderAvailable('gemini')).toBe(true)
    recordProviderSuccess('gemini')
    expect(isProviderAvailable('gemini')).toBe(true)
    expect(isProviderAvailable('gemini')).toBe(true)
  })

  it('re-opens a full window when the probe fails', () => {
    tripBreaker('gemini')
    vi.advanceTimersByTime(5 * 60_000)
    expect(isProviderAvailable('gemini')).toBe(true)
    recordProviderFailure('gemini')
    expect(isProviderAvailable('gemini')).toBe(false)
    vi.advanceTimersByTime(5 * 60_000 - 1)
    expect(isProviderAvailable('gemini')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(isProviderAvailable('gemini')).toBe(true)
  })

  it('frees a stuck probe slot after the probe deadline', () => {
    // 试探请求的进程可能中断而永远不归还结论：名额必须有兜底时限，
    // 否则该 provider 会被一个悬挂的试探永久判为不可用。
    tripBreaker('gemini')
    vi.advanceTimersByTime(5 * 60_000)
    expect(isProviderAvailable('gemini')).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(isProviderAvailable('gemini')).toBe(true)
  })

  it('resets a single provider without touching the others', () => {
    tripBreaker('gemini')
    tripBreaker('stepfun')
    resetBreaker('gemini')
    expect(isProviderAvailable('gemini')).toBe(true)
    expect(isProviderAvailable('stepfun')).toBe(false)
  })
})
