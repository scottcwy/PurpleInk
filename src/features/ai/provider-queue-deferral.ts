export type ProviderDispatchWaitReason =
  | 'cooldown'
  | 'pacing'
  | 'rpm'
  | 'tpm'
  | 'concurrency'
  | 'fairness'

export interface ProviderQueueDeferralOptions {
  providerId: string
  providerLabel: string
  scopeKey: string
  waitReason: ProviderDispatchWaitReason
  retryAt: Date
}

/**
 * Provider 发送许可尚未就绪时使用的队列控制信号。
 *
 * 它不是 Provider 请求失败，不能进入普通错误分类、重试预算或熔断。
 */
export class ProviderQueueDeferral extends Error {
  override readonly name = 'ProviderQueueDeferral'
  readonly providerId: string
  readonly providerLabel: string
  readonly scopeKey: string
  readonly waitReason: ProviderDispatchWaitReason
  readonly retryAt: string

  constructor(options: ProviderQueueDeferralOptions) {
    super(`${options.providerLabel}正在等待可用调用窗口`)
    this.providerId = options.providerId
    this.providerLabel = options.providerLabel
    this.scopeKey = options.scopeKey
    this.waitReason = options.waitReason
    this.retryAt = options.retryAt.toISOString()
  }
}
