import type { ResolvedExecutionPlanV2 } from './execution-plan'
import type {
  InvocationExecutionMetadata,
  ManagedAiBeginInput,
} from './managed-gateway'
import { RouteContractError } from './route-contract-error'

export function gatewayExecutionMetadata(
  input: ManagedAiBeginInput,
  invocationId: string,
): InvocationExecutionMetadata {
  return {
    operationId: input.execution?.operationId ?? invocationId,
    attemptGroupId: input.execution?.attemptGroupId ?? input.attemptId,
    logicalModelId: input.resolvedPlan?.logicalModelId
      ?? input.execution?.logicalModelId
      ?? input.model,
    outboundModelId: input.resolvedPlan?.outboundModelId
      ?? input.execution?.outboundModelId
      ?? input.model,
    deploymentId: input.resolvedPlan?.deploymentId ?? input.execution?.deploymentId,
    channelId: input.resolvedPlan?.channelId ?? input.execution?.channelId,
    adapterProtocol: input.resolvedPlan?.adapterProtocol
      ?? input.execution?.adapterProtocol,
    officialPriceIdentity: input.resolvedPlan?.officialPriceIdentity
      ?? input.execution?.officialPriceIdentity,
    providerPoolId: input.resolvedPlan?.providerPoolId
      ?? input.execution?.providerPoolId,
    failureDomainId: input.resolvedPlan?.failureDomainId
      ?? input.execution?.failureDomainId,
    planVersion: input.resolvedPlan?.planVersion ?? input.execution?.planVersion,
    entitlementRateCardId: input.execution?.entitlementRateCardId,
  }
}

export function assertResolvedPlanMatches(
  input: ManagedAiBeginInput,
  plan: ResolvedExecutionPlanV2,
): void {
  if (
    input.provider !== plan.providerId
    || input.model !== plan.outboundModelId
    || input.capability !== plan.capability
  ) {
    throw new RouteContractError('冻结执行计划与调用参数不一致')
  }
  if (plan.fundingSource === 'managed' && !plan.catalogId) {
    throw new RouteContractError('托管执行计划缺少目录身份')
  }
}
