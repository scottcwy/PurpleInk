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
 * 队列层据此复用同一 attempt 并推迟 visibleAt，避免制造重试记录。
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
