import {
  ProviderRequestError,
  type ProviderFunding,
} from './provider-request-error'

export type ProviderDispatchWaitReason =
  | 'cooldown'
  | 'pacing'
  | 'rpm'
  | 'tpm'
  | 'concurrency'
  | 'fairness'

/**
 * 平台调度器主动排队，不代表供应商真的返回了 429。
 * 队列层据此终结当前 attempt 并创建延后 visibleAt 的续接 attempt；
 * queueMeta.ordinaryAttemptNo 保持不变，因此不消耗普通重试预算。
 */
export class ProviderDispatchWaitError extends ProviderRequestError {
  override readonly name = 'ProviderDispatchWaitError'
  readonly scopeKey: string
  readonly waitReason: ProviderDispatchWaitReason

  constructor(input: {
    providerId: string
    providerLabel: string
    funding: ProviderFunding
    retryAt: Date
    scopeKey: string
    waitReason: ProviderDispatchWaitReason
  }) {
    super({
      providerId: input.providerId,
      providerLabel: input.providerLabel,
      operation: '调用',
      funding: input.funding,
      httpStatus: 429,
      retryAt: input.retryAt,
      kind: 'rate_limit',
    })
    this.scopeKey = input.scopeKey
    this.waitReason = input.waitReason
  }
}
