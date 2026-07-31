/**
 * 主备 provider 均不可用（熔断 open 且无可用备选）时的失败类型。
 *
 * 存在原因：这是**外部服务故障**的一种表现，必须归类为 `PROVIDER_FAILED` 且
 * `retryable=true`——熔断窗口过后重试是有意义的。若抛普通 `Error`，文案里没有
 * 「provider / 模型」等词会落进阶段兜底，有则可能撞上「配置不可用」被误判成
 * 不可重试（模式 B）。带类型让 `classifyWorkflowError` 在文案匹配之前按类型判定。
 *
 * 文案固定为类别指引，不携带任何 provider 原始错误、模型名或凭据。
 */
export class ProviderUnavailableError extends Error {
  override readonly name = 'ProviderUnavailableError'

  constructor() {
    super('AI 服务暂时不可用，可稍后重试或选择跳过')
  }
}
