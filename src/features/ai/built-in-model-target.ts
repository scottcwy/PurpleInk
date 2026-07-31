import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { BuiltInProviderId } from '@/lib/config/generated/ai-billing-manifest'
import {
  fundingForProvider,
  resolveProviderApiKey,
  type AiConfigDependencies,
} from './config'
import {
  freezeResolvedExecutionPlanV2,
  resolveDeploymentBinding,
  resolveDeploymentBindingById,
  type AdapterProtocol,
  type ResolvedExecutionPlanV2,
} from './execution-plan'
import { AI_BILLING_MANIFEST } from '@/lib/config/generated/ai-billing-manifest'
import { managedCredentialUnavailableError } from './managed-service'
import {
  authorizeManagedRoute,
  type ManagedPlanKey,
  type ManagedRouteAuthorization,
} from './managed-service'
import type { ProviderCapability } from './provider-registry'

export interface BuiltInModelTarget {
  provider: BuiltInProviderId
  baseUrl: string
  modelId: string
  logicalModelId: string
  deploymentId: string
  channelId: string
  adapterProtocol: AdapterProtocol
  officialPriceIdentity: string
  providerPoolId: string
  failureDomainId: string
  fallbackDeploymentId?: string
  fallback?: {
    deploymentId: string
    logicalModelId: string
    modelId: string
    officialPriceIdentity: string
  }
  apiKey: string | null
  funding: ManagedRouteAuthorization['funding']
  deductsManagedPool: boolean
  resolvedPlan: ResolvedExecutionPlanV2
}

export async function resolveBuiltInModelTarget(input: {
  provider: BuiltInProviderId
  logicalModelId?: string
  capability: ProviderCapability
  plan: ManagedPlanKey
  deps: AiConfigDependencies
}): Promise<BuiltInModelTarget> {
  const funding = await fundingForProvider(input.provider, input.deps)
  const binding = resolveDeploymentBinding({
    providerId: input.provider,
    fundingSource: funding,
    capability: input.capability,
    ...(input.logicalModelId ? { logicalModelId: input.logicalModelId } : {}),
  })
  const authorization = await authorizeManagedRoute({
    plan: input.plan,
    provider: input.provider,
    modelId: binding.logicalModelId,
    capability: input.capability,
    funding,
  }, input.deps.managedModelCatalog)
  const fallback = binding.fallbackDeploymentId
    ? resolveDeploymentBindingById(binding.fallbackDeploymentId, input.capability)
    : null
  const fallbackAuthorization = fallback
    ? await authorizeManagedRoute({
        plan: input.plan,
        provider: fallback.providerId,
        modelId: fallback.logicalModelId,
        capability: input.capability,
        funding,
      }, input.deps.managedModelCatalog)
    : null
  const apiKey = await resolveProviderApiKey(input.provider, input.deps)
  if (!apiKey) throw managedCredentialUnavailableError()
  const { catalogId: _catalogId, ...publicAuthorization } = authorization
  const planVersion = AI_BILLING_MANIFEST.catalogVersions.plans
  const credentialLease = {
    source: funding,
    reference: binding.secretRef,
    version: planVersion,
    credential: apiKey,
  } as const
  const fallbackPlan = fallback
    ? freezeResolvedExecutionPlanV2({
        schemaVersion: 2,
        kind: 'built-in',
        providerId: fallback.providerId,
        fundingSource: funding,
        logicalModelId: fallback.logicalModelId,
        outboundModelId: fallback.outboundModelId,
        deploymentId: fallback.deploymentId,
        channelId: fallback.channelId,
        adapterProtocol: fallback.adapterProtocol,
        baseUrl: fallback.baseUrl,
        officialPriceIdentity: fallback.officialPriceIdentity,
        providerPoolId: funding === 'managed'
          ? fallback.providerPoolId
          : `${currentWorkspaceId()}:${input.provider}`,
        failureDomainId: funding === 'managed'
          ? fallback.failureDomainId
          : `${currentWorkspaceId()}:${input.provider}`,
        capability: input.capability,
        planVersion,
        ...(fallbackAuthorization?.catalogId
          ? { catalogId: fallbackAuthorization.catalogId }
          : {}),
        credentialLease,
      })
    : null
  const resolvedPlan = freezeResolvedExecutionPlanV2({
    schemaVersion: 2,
    kind: 'built-in',
    providerId: input.provider,
    fundingSource: funding,
    logicalModelId: binding.logicalModelId,
    outboundModelId: binding.outboundModelId,
    deploymentId: binding.deploymentId,
    channelId: binding.channelId,
    adapterProtocol: binding.adapterProtocol,
    baseUrl: binding.baseUrl,
    officialPriceIdentity: binding.officialPriceIdentity,
    providerPoolId: funding === 'managed'
      ? binding.providerPoolId
      : `${currentWorkspaceId()}:${input.provider}`,
    failureDomainId: funding === 'managed'
      ? binding.failureDomainId
      : `${currentWorkspaceId()}:${input.provider}`,
    capability: input.capability,
    planVersion,
    ...(authorization.catalogId ? { catalogId: authorization.catalogId } : {}),
    credentialLease,
    ...(fallbackPlan ? { fallback: fallbackPlan } : {}),
  })
  return {
    provider: input.provider,
    baseUrl: binding.baseUrl,
    modelId: binding.outboundModelId,
    logicalModelId: binding.logicalModelId,
    deploymentId: binding.deploymentId,
    channelId: binding.channelId,
    adapterProtocol: binding.adapterProtocol,
    officialPriceIdentity: binding.officialPriceIdentity,
    providerPoolId: funding === 'managed'
      ? binding.providerPoolId
      : `${currentWorkspaceId()}:${input.provider}`,
    failureDomainId: funding === 'managed'
      ? binding.failureDomainId
      : `${currentWorkspaceId()}:${input.provider}`,
    ...(binding.fallbackDeploymentId
      ? { fallbackDeploymentId: binding.fallbackDeploymentId }
      : {}),
    ...(fallback
      ? {
          fallback: {
            deploymentId: fallback.deploymentId,
            logicalModelId: fallback.logicalModelId,
            modelId: fallback.outboundModelId,
            officialPriceIdentity: fallback.officialPriceIdentity,
          },
        }
      : {}),
    apiKey,
    resolvedPlan,
    ...publicAuthorization,
  }
}
