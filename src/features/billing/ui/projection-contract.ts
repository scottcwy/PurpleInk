import type { BillingProjection } from '../contracts'
import type { PlanKey } from '../domain'

/**
 * 浏览器可见的最小计费投影。严禁加入内部成本池、供应商单价或汇率字段。
 * 核心 `BillingProjection` 必须可赋值给此接口，UI 只消费这些脱敏字段。
 */
export type BillingUiProjection = BillingProjection

export function isBillingUiProjection(value: unknown): value is BillingUiProjection {
  if (!value || typeof value !== 'object') return false
  const projection = value as Record<string, unknown>
  const cycle = projection.cycle
  const usage = projection.usage
  const tokenUsage = projection.tokenUsage
  const providerCalls = projection.providerCalls
  return (
    isPlanKey(projection.planKey)
    && Boolean(cycle)
    && typeof cycle === 'object'
    && typeof (cycle as Record<string, unknown>).startsAt === 'string'
    && typeof (cycle as Record<string, unknown>).endsAt === 'string'
    && Boolean(usage)
    && typeof usage === 'object'
    && typeof (usage as Record<string, unknown>).percent === 'number'
    && typeof (usage as Record<string, unknown>).remainingPercent === 'number'
    && typeof (usage as Record<string, unknown>).invocationCount === 'number'
    && Boolean(tokenUsage)
    && typeof tokenUsage === 'object'
    && typeof (tokenUsage as Record<string, unknown>).inputTokens === 'number'
    && typeof (tokenUsage as Record<string, unknown>).outputTokens === 'number'
    && Boolean(providerCalls)
    && typeof providerCalls === 'object'
    && typeof (providerCalls as Record<string, unknown>).stepfun === 'number'
    && typeof (providerCalls as Record<string, unknown>).mimo === 'number'
    && typeof (providerCalls as Record<string, unknown>).gemini === 'number'
    && typeof (providerCalls as Record<string, unknown>).openai === 'number'
    && typeof (providerCalls as Record<string, unknown>).anthropic === 'number'
    && (projection.lastInvocationAt === null || typeof projection.lastInvocationAt === 'string')
    && typeof projection.canRedeem === 'boolean'
  )
}

function isPlanKey(value: unknown): value is PlanKey {
  return value === 'free' || value === 'plus' || value === 'pro' || value === 'max'
}
