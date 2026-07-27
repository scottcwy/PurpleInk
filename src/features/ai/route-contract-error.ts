/**
 * 路由 / 能力合同错误：用户选定的供应商与该路由的能力要求矛盾，或路由所需配置
 * 根本不存在。
 *
 * 存在原因：这类失败是**应用内部或设置面的矛盾**，不是外部服务本次抖动。旧实现
 * 抛普通 `Error`，报文里含「模型 / TTS / ASR」等词，被 `classifyWorkflowError`
 * 的文案规则归成 `PROVIDER_FAILED` 且可重试，于是画布劝用户反复重试一个必然失败
 * 的作业（真实事故）。带类型的错误让分类器在文案匹配之前就按类型判定。
 */
export class RouteContractError extends Error {
  override readonly name = 'RouteContractError'

  constructor(message: string) {
    super(message)
  }
}
