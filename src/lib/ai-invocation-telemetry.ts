export const COMPLETE_AI_INVOCATION_TELEMETRY_VERSION = 3 as const
export const LEGACY_AI_INVOCATION_TELEMETRY_VERSION = 2 as const

export interface AiInvocationRouteIdentity {
  logicalModelId?: string
  outboundModelId?: string
  deploymentId?: string
  channelId?: string
  adapterProtocol?: string
  officialPriceIdentity?: string
  providerPoolId?: string
  failureDomainId?: string
  planVersion?: string
}

const REQUIRED_IDENTITY_FIELDS = [
  'logicalModelId',
  'outboundModelId',
  'deploymentId',
  'channelId',
  'adapterProtocol',
  'officialPriceIdentity',
  'providerPoolId',
  'failureDomainId',
  'planVersion',
] as const satisfies readonly (keyof AiInvocationRouteIdentity)[]

export function aiInvocationTelemetryVersion(
  identity: AiInvocationRouteIdentity,
): 2 | 3 {
  return REQUIRED_IDENTITY_FIELDS.every((field) => {
    const value = identity[field]
    return typeof value === 'string' && value.trim().length > 0
  })
    ? COMPLETE_AI_INVOCATION_TELEMETRY_VERSION
    : LEGACY_AI_INVOCATION_TELEMETRY_VERSION
}
