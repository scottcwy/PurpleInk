import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  DEFAULT_EXECUTION_TIMEOUT_MS,
  EXECUTION_TIMEOUT_MS,
  executionTimeoutMs,
  HEARTBEAT_INTERVAL_MS,
  LEASE_DURATION_MS,
  leaseDurationMs,
  SWEEP_INTERVAL_MS,
  withExecutionTimeout,
} from './lease'

describe('租约与执行超时常量', () => {
  it('锁定容灾节奏：租约 2 分钟、心跳 30 秒、清扫 60 秒', () => {
    expect(LEASE_DURATION_MS).toBe(120_000)
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000)
    expect(SWEEP_INTERVAL_MS).toBe(60_000)
  })

  it('按 kind 给执行超时：导出与异步旁白均保留 30 分钟合同', () => {
    expect(EXECUTION_TIMEOUT_MS['director-stage']).toBe(600_000)
    expect(EXECUTION_TIMEOUT_MS['render-shot']).toBe(900_000)
    expect(EXECUTION_TIMEOUT_MS['export-project']).toBe(1_800_000)
    expect(EXECUTION_TIMEOUT_MS['media-narration']).toBe(1_800_000)
    expect(executionTimeoutMs('director-stage')).toBe(600_000)
    expect(executionTimeoutMs('render-shot')).toBe(900_000)
    expect(executionTimeoutMs('export-project')).toBe(1_800_000)
    expect(executionTimeoutMs('media-narration')).toBe(1_800_000)
    expect(DEFAULT_EXECUTION_TIMEOUT_MS).toBe(600_000)
  })

  it('租约覆盖该 kind 的完整执行窗口与一次清扫间隔，不能在合法执行中途回收', () => {
    expect(leaseDurationMs('director-stage')).toBe(660_000)
    expect(leaseDurationMs('render-shot')).toBe(960_000)
    expect(leaseDurationMs('export-project')).toBe(1_860_000)
    expect(leaseDurationMs('media-narration')).toBe(1_860_000)
    expect(leaseDurationMs('unknown-kind')).toBe(660_000)
  })
})

describe('withExecutionTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('永不 resolve 的 handler 到达 kind 超时后强制失败，并注明超时分钟数', async () => {
    vi.useFakeTimers()
    const pending = withExecutionTimeout(
      'director-stage',
      () => new Promise<never>(() => {})
    )
    const assertion = expect(pending).rejects.toThrow(
      '阶段执行超时（10 分钟），已强制释放'
    )
    await vi.advanceTimersByTimeAsync(600_000)
    await assertion
  })

  it('render-shot 使用 15 分钟超时：14 分钟时仍未失败', async () => {
    vi.useFakeTimers()
    let settled = false
    const pending = withExecutionTimeout(
      'render-shot',
      () => new Promise<never>(() => {})
    ).catch((error: unknown) => {
      settled = true
      throw error
    })
    const assertion = expect(pending).rejects.toThrow(
      '阶段执行超时（15 分钟），已强制释放'
    )
    await vi.advanceTimersByTimeAsync(840_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
    expect(settled).toBe(true)
  })

  it('handler 按时完成则原样返回结果并清理定时器', async () => {
    vi.useFakeTimers()
    await expect(
      withExecutionTimeout('director-stage', async () => 'ok')
    ).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('handler 先失败时透传原始错误，不被包装成超时', async () => {
    await expect(
      withExecutionTimeout('render-shot', () => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom')
  })
})
