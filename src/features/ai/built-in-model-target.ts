import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { BuiltInProviderId } from '@/lib/config/generated/ai-billing-manifest'
import {
  fundingForProvider,
  resolveProviderApiKey,
  type AiConfigDependencies,
} from './config'
import {
  resolveDeploymentBinding,
  resolveDeploymentBindingById,
  type AdapterProtocol,
} from './execution-plan'
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
}

export async function resolveBuiltInModelTarget(input: {
  provider: BuiltInProviderId
  logicalModelId: string
  capability: ProviderCapability
  plan: ManagedPlanKey
  deps: AiConfigDependencies
}): Promise<BuiltInModelTarget> {
  const funding = await fundingForProvider(input.provider, input.deps)
  const authorization = await authorizeManagedRoute({
    plan: input.plan,
    provider: input.provider,
    modelId: input.logicalModelId,
    capability: input.capability,
    funding,
  }, input.deps.managedModelCatalog)
  const binding = resolveDeploymentBinding({
    providerId: input.provider,
    fundingSource: funding,
    capability: input.capability,
    logicalModelId: input.logicalModelId,
  })
  const fallback = binding.fallbackDeploymentId
    ? resolveDeploymentBindingById(binding.fallbackDeploymentId, input.capability)
    : null
  const apiKey = await resolveProviderApiKey(input.provider, input.deps)
  const { catalogId: _catalogId, ...publicAuthorization } = authorization
  return {
    provider: input.provider,
    baseUrl: binding.baseUrl,
    modelId: binding.outboundModelId,
    logicalModelId: binding.logicalModelId,
    deploymentId: binding.deploymentId,
    channelId: binding.channelId,
    adapterProtocol: binding.adapterProtocol,
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
    ...publicAuthorization,
  }
}
