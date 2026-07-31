import type { BuiltInProviderId } from '@/lib/config/generated/ai-billing-manifest'
import type { AiProviderId, ProviderCapability } from './provider-registry'

export type AdapterProtocol = 'openai-completions' | 'anthropic-messages'

export interface CredentialLease {
  readonly source: 'managed' | 'byok' | 'custom'
  readonly reference: string
  readonly version: string
  readonly credential: string
}

interface ExecutionRoutePlanV2Base {
  readonly schemaVersion: 2
  readonly providerId: AiProviderId
  readonly logicalModelId: string
  readonly outboundModelId: string
  readonly deploymentId: string
  readonly channelId: string
  readonly adapterProtocol: AdapterProtocol
  readonly baseUrl: string
  readonly officialPriceIdentity: string
  readonly providerPoolId: string
  readonly failureDomainId: string
  readonly capability: ProviderCapability
  readonly planVersion: string
  readonly catalogId?: string
  readonly credentialLease: CredentialLease
  readonly fallback?: ResolvedExecutionPlanV2
}

export type ResolvedExecutionPlanV2 = Readonly<
  | (ExecutionRoutePlanV2Base & {
      kind: 'built-in'
      providerId: BuiltInProviderId
      fundingSource: 'managed' | 'byok'
    })
  | (ExecutionRoutePlanV2Base & {
      kind: 'custom'
      fundingSource: 'custom'
    })
>

export function freezeResolvedExecutionPlanV2(
  plan: ResolvedExecutionPlanV2,
): ResolvedExecutionPlanV2 {
  return Object.freeze({
    ...plan,
    credentialLease: Object.freeze({ ...plan.credentialLease }),
    ...(plan.fallback
      ? { fallback: freezeResolvedExecutionPlanV2(plan.fallback) }
      : {}),
  })
}
