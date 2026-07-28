import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('backoffMs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('随机因子为 0.5 时恰为 5000 * 2^attemptNo 的无抖动基值', async () => {
    const { backoffMs } = await import('./retry-policy')
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(backoffMs(1)).toBe(10_000)
    expect(backoffMs(2)).toBe(20_000)
  })

  it('抖动边界是基值的 ±20%：随机 0 取下界，随机 1 取上界', async () => {
    const { backoffMs } = await import('./retry-policy')
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0)
    expect(backoffMs(1)).toBe(8_000)
    expect(backoffMs(2)).toBe(16_000)
    random.mockReturnValue(1)
    expect(backoffMs(1)).toBe(12_000)
    expect(backoffMs(2)).toBe(24_000)
  })

  it('真实随机下始终落在 [0.8, 1.2] * 基值 区间内且为整数毫秒', async () => {
    const { backoffMs } = await import('./retry-policy')
    for (let attemptNo = 1; attemptNo <= 3; attemptNo += 1) {
      const base = 5000 * 2 ** attemptNo
      for (let round = 0; round < 100; round += 1) {
        const delay = backoffMs(attemptNo)
        expect(Number.isInteger(delay)).toBe(true)
        expect(delay).toBeGreaterThanOrEqual(base * 0.8)
        expect(delay).toBeLessThanOrEqual(base * 1.2)
      }
    }
  })
})

describe('shouldAutoRetry', () => {
  it('可重试报文在 attemptNo <= MAX_AUTO_RETRIES 时允许自动重试', async () => {
    const { shouldAutoRetry, MAX_AUTO_RETRIES } = await import('./retry-policy')
    expect(MAX_AUTO_RETRIES).toBe(2)
    // 租约过期回收：classifyWorkflowError 归 TASK_INTERRUPTED，retryable=true。
    const message = '执行进程中断，租约过期自动回收'
    expect(shouldAutoRetry(message, 1)).toBe(true)
    expect(shouldAutoRetry(message, 2)).toBe(true)
  })

  it('attemptNo 超过 MAX_AUTO_RETRIES 后即使报文可重试也拒绝', async () => {
    const { shouldAutoRetry } = await import('./retry-policy')
    expect(shouldAutoRetry('执行进程中断，租约过期自动回收', 3)).toBe(false)
    expect(shouldAutoRetry('执行进程中断，租约过期自动回收', 4)).toBe(false)
  })

  it('不可重试类别（配置/凭据、重试预算耗尽）在任何 attemptNo 都拒绝', async () => {
    const { shouldAutoRetry, RETRY_BUDGET_EXHAUSTED_MESSAGE } = await import(
      './retry-policy'
    )
    // CONFIGURATION_BLOCKED：重试不会改变结果。
    expect(shouldAutoRetry('尚未配置 StepFun API Key', 1)).toBe(false)
    // RETRY_BUDGET_EXHAUSTED：闸门自身的报文绝不能再触发自动重试。
    expect(shouldAutoRetry(RETRY_BUDGET_EXHAUSTED_MESSAGE, 1)).toBe(false)
  })

  it('按 stage 兜底分类：未识别报文在渲染阶段仍视为可重试', async () => {
    const { shouldAutoRetry } = await import('./retry-policy')
    expect(shouldAutoRetry('未知内部失败', 1, 'RENDER')).toBe(true)
    expect(shouldAutoRetry('未知内部失败', 1)).toBe(true)
  })
})

describe('RetryBudgetExhaustedError', () => {
  it('按类型名可判定，文案含暂停原因与出口指引', async () => {
    const { RetryBudgetExhaustedError } = await import('./retry-policy')
    const error = new RetryBudgetExhaustedError()
    expect(error.name).toBe('RetryBudgetExhaustedError')
    expect(error.message).toContain('已暂停重试')
    expect(error.message).toContain('跳过')
  })
})
