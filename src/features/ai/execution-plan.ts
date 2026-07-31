import 'server-only'
import { PLAN_DEFINITIONS, type PlanKey } from '@/features/billing'
import {
  AI_BILLING_MANIFEST,
  type BuiltInProviderId,
} from '@/lib/config/generated/ai-billing-manifest'
import { ManagedAiError } from './managed-service'
import type { ProviderCapability } from './provider-registry'

export type FundingSource = 'managed' | 'byok'
export type AdapterProtocol = 'openai-completions' | 'anthropic-messages'

export interface ExecutionPlan {
  operationId: string
  attemptGroupId: string
  workspaceId: string
  workload: string
  providerId: BuiltInProviderId
  fundingSource: FundingSource
  logicalModelId: string
  deploymentId: string
  outboundModelId: string
  officialPriceIdentity: string
  channelId: string
  adapterProtocol: AdapterProtocol
  baseUrlRef: string
  baseUrl: string
  secretRef: string
  capability: ProviderCapability
  capabilityVerification: 'verified' | 'declared'
  providerPoolId: string
  failureDomainId: string
  maxInFlight: number
  fallbackDeploymentId?: string
  officialRateCardId?: string
  entitlementRateCardId?: string
  usagePeriodId?: string
  planVersion: string
}

export interface ResolvedExecutionPlan {
  plan: Readonly<ExecutionPlan>
  credential: string
}

export interface DeploymentBinding {
  providerId: BuiltInProviderId
  fundingSource: FundingSource
  logicalModelId: string
  deploymentId: string
  outboundModelId: string
  officialPriceIdentity: string
  channelId: string
  adapterProtocol: AdapterProtocol
  baseUrl: string
  secretRef: string
  providerPoolId: string
  failureDomainId: string
  maxInFlight: number
  capabilityVerification: 'verified' | 'declared'
  fallbackDeploymentId?: string
}

export interface ExecutionPlanDependencies {
  env: Record<string, string | undefined>
  loadByokCredential: (
    workspaceId: string,
    providerId: BuiltInProviderId,
  ) => Promise<string | null>
  now: Date
}

export interface ResolveExecutionPlanInput {
  operationId: string
  attemptGroupId: string
  workspaceId: string
  workload: string
  providerId: BuiltInProviderId
  fundingSource: FundingSource
  planKey: PlanKey
  capability: ProviderCapability
  logicalModelId?: string
  usagePeriodId?: string
}

export async function resolveExecutionPlan(
  input: ResolveExecutionPlanInput,
  dependencies: ExecutionPlanDependencies,
): Promise<ResolvedExecutionPlan> {
  authorizePlan(input)
  const binding = resolveDeploymentBinding(input)
  const deployment = findDeployment(input)
  const credential = await resolveCredential(input, deployment, dependencies)
  const officialRateCardId = input.fundingSource === 'managed'
    ? activeRateCardId(deployment.officialPriceIdentity, dependencies.now)
    : undefined
  const entitlementRateCardId = input.fundingSource === 'managed'
    ? serviceMultiplierId(input.capability)
    : undefined
  const plan: ExecutionPlan = {
    operationId: input.operationId,
    attemptGroupId: input.attemptGroupId,
    workspaceId: input.workspaceId,
    workload: input.workload,
    providerId: input.providerId,
    fundingSource: input.fundingSource,
    logicalModelId: binding.logicalModelId,
    deploymentId: binding.deploymentId,
    outboundModelId: binding.outboundModelId,
    officialPriceIdentity: binding.officialPriceIdentity,
    channelId: binding.channelId,
    adapterProtocol: binding.adapterProtocol,
    baseUrlRef: binding.channelId,
    baseUrl: binding.baseUrl,
    secretRef: binding.secretRef,
    capability: input.capability,
    capabilityVerification: binding.capabilityVerification,
    providerPoolId: binding.providerPoolId,
    failureDomainId: binding.failureDomainId,
    maxInFlight: binding.maxInFlight,
    planVersion: AI_BILLING_MANIFEST.catalogVersions.plans,
    ...(binding.fallbackDeploymentId
      ? { fallbackDeploymentId: binding.fallbackDeploymentId }
      : {}),
    ...(officialRateCardId ? { officialRateCardId } : {}),
    ...(entitlementRateCardId ? { entitlementRateCardId } : {}),
    ...(input.usagePeriodId ? { usagePeriodId: input.usagePeriodId } : {}),
  }
  return { plan: Object.freeze(plan), credential }
}

export function resolveDeploymentBinding(input: {
  providerId: BuiltInProviderId
  fundingSource: FundingSource
  capability: ProviderCapability
  logicalModelId?: string
}): DeploymentBinding {
  const deployment = findDeployment(input)
  return {
    providerId: input.providerId,
    fundingSource: input.fundingSource,
    logicalModelId: deployment.logicalModelId,
    deploymentId: deployment.id,
    outboundModelId: deployment.outboundModelId,
    officialPriceIdentity: deployment.officialPriceIdentity,
    channelId: deployment.channelId,
    adapterProtocol: deployment.adapter,
    baseUrl: deployment.baseUrl,
    secretRef: deployment.secretRef,
    providerPoolId: deployment.providerPoolId,
    failureDomainId: deployment.failureDomainId,
    maxInFlight: deployment.maxInFlight,
    capabilityVerification: deployment.verifiedCapabilities
      .some((capability) => capability === input.capability)
      ? 'verified'
      : 'declared',
    ...('fallbackDeploymentId' in deployment && deployment.fallbackDeploymentId
      ? { fallbackDeploymentId: deployment.fallbackDeploymentId }
      : {}),
  }
}

export function resolveDeploymentBindingById(
  deploymentId: string,
  capability: ProviderCapability,
): DeploymentBinding {
  const deployment = AI_BILLING_MANIFEST.deployments.find((candidate) =>
    candidate.id === deploymentId
    && candidate.capabilities.some((item) => item === capability))
  if (!deployment) throw modelNotAuthorized()
  return {
    providerId: deployment.providerId,
    fundingSource: deployment.funding,
    logicalModelId: deployment.logicalModelId,
    deploymentId: deployment.id,
    outboundModelId: deployment.outboundModelId,
    officialPriceIdentity: deployment.officialPriceIdentity,
    channelId: deployment.channelId,
    adapterProtocol: deployment.adapter,
    baseUrl: deployment.baseUrl,
    secretRef: deployment.secretRef,
    providerPoolId: deployment.providerPoolId,
    failureDomainId: deployment.failureDomainId,
    maxInFlight: deployment.maxInFlight,
    capabilityVerification: deployment.verifiedCapabilities
      .some((item) => item === capability)
      ? 'verified'
      : 'declared',
    ...('fallbackDeploymentId' in deployment && deployment.fallbackDeploymentId
      ? { fallbackDeploymentId: deployment.fallbackDeploymentId }
      : {}),
  }
}

export type GeminiFallbackFailureKind =
  | 'rate_limit'
  | 'upstream_unavailable'
  | 'network'
  | 'timeout'
  | 'authentication'
  | 'configuration'
  | 'quota'
  | 'input_contract'
  | 'content'
  | 'unknown'

export function shouldUseGeminiModelFallback(
  plan: Pick<
    ExecutionPlan,
    'providerId' | 'fundingSource' | 'fallbackDeploymentId'
  >,
  failureKind: GeminiFallbackFailureKind,
): boolean {
  if (
    plan.providerId !== 'gemini'
    || plan.fundingSource !== 'managed'
    || !plan.fallbackDeploymentId
  ) {
    return false
  }
  return [
    'rate_limit',
    'upstream_unavailable',
    'network',
    'timeout',
  ].includes(failureKind)
}

type Deployment = (typeof AI_BILLING_MANIFEST.deployments)[number]

function findDeployment(input: {
  providerId: BuiltInProviderId
  fundingSource: FundingSource
  capability: ProviderCapability
  logicalModelId?: string
}): Deployment {
  const deployment = AI_BILLING_MANIFEST.deployments.find((candidate) =>
    candidate.providerId === input.providerId
    && candidate.funding === input.fundingSource
    && candidate.capabilities.some((item) => item === input.capability)
    && (
      input.logicalModelId === undefined
      || candidate.logicalModelId === input.logicalModelId
    ))
  if (!deployment) throw modelNotAuthorized()
  return deployment
}

function authorizePlan(input: ResolveExecutionPlanInput): void {
  if (input.fundingSource === 'byok') return
  if (
    !PLAN_DEFINITIONS[input.planKey].managedProviders
      .some((provider) => provider === input.providerId)
  ) {
    throw modelNotAuthorized()
  }
}

async function resolveCredential(
  input: ResolveExecutionPlanInput,
  deployment: Deployment,
  dependencies: ExecutionPlanDependencies,
): Promise<string> {
  const raw = input.fundingSource === 'managed'
    ? dependencies.env[deployment.secretRef]
    : await dependencies.loadByokCredential(
        input.workspaceId,
        input.providerId,
      )
  const credential = raw?.trim()
  if (credential) return credential
  throw new ManagedAiError({
    code: 'MANAGED_CREDENTIAL_UNAVAILABLE',
    status: 503,
    retryable: false,
    message: input.fundingSource === 'managed'
      ? '托管 AI 服务凭据未配置，请联系管理员完成服务配置。'
      : '自有 API Key 尚未配置或验证',
  })
}

function activeRateCardId(identity: string, now: Date): string {
  const timestamp = now.getTime()
  const card = AI_BILLING_MANIFEST.rateCards.find((candidate) =>
    candidate.officialPriceIdentity === identity
    && Date.parse(candidate.effectiveFrom) <= timestamp
    && (
      !('effectiveTo' in candidate)
      || Date.parse(candidate.effectiveTo) > timestamp
    ))
  if (!card) throw new Error(`official rate card unavailable for ${identity}`)
  return card.id
}

function serviceMultiplierId(capability: ProviderCapability): string {
  const multiplier = AI_BILLING_MANIFEST.serviceMultipliers.find((candidate) =>
    candidate.capability === capability)
  if (!multiplier) {
    throw new Error(`entitlement rate card unavailable for ${capability}`)
  }
  return multiplier.id
}

function modelNotAuthorized(): ManagedAiError {
  return new ManagedAiError({
    code: 'MANAGED_MODEL_NOT_AUTHORIZED',
    status: 403,
    retryable: false,
    message: '当前套餐不可使用所选托管模型',
  })
}
