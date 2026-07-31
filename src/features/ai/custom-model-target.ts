import { freezeResolvedExecutionPlanV2 } from './execution-plan'
import type { ManagedRouteAuthorization } from './managed-service'
import type { AiProviderId, ProviderCapability } from './provider-registry'
import { RouteContractError } from './route-contract-error'

export function createCustomModelTarget(input: {
  workspaceId: string
  provider: AiProviderId
  model: string
  secret: string | null
  baseUrl: string
  capability: ProviderCapability
  authorization: ManagedRouteAuthorization
}) {
  if (!input.secret) {
    throw new RouteContractError('所选自定义模型尚未配置 API Key')
  }
  const routeIdentity = `${input.workspaceId}:${input.provider}`
  const planVersion = 'workspace-route/v1'
  const resolvedPlan = freezeResolvedExecutionPlanV2({
    schemaVersion: 2,
    kind: 'custom',
    providerId: input.provider,
    fundingSource: 'custom',
    logicalModelId: input.model,
    outboundModelId: input.model,
    deploymentId: `workspace.${input.provider}.${input.capability}`,
    channelId: `workspace.${input.provider}`,
    adapterProtocol: 'openai-completions',
    baseUrl: input.baseUrl,
    officialPriceIdentity: `custom.${input.provider}.${input.model}`,
    providerPoolId: routeIdentity,
    failureDomainId: routeIdentity,
    capability: input.capability,
    planVersion,
    credentialLease: {
      source: 'custom',
      reference: `workspace-credential:${input.provider}`,
      version: planVersion,
      credential: input.secret,
    },
  })
  const { catalogId: _catalogId, ...publicAuthorization } = input.authorization
  return {
    provider: input.provider,
    baseUrl: input.baseUrl,
    modelId: input.model,
    apiKey: input.secret,
    resolvedPlan,
    ...publicAuthorization,
  }
}
