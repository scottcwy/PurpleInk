import { createHash } from 'node:crypto'
import type { ProviderFunding } from './provider-request-error'

export function providerScopeKey(input: {
  providerId: string
  poolId?: string
  funding: ProviderFunding
  workspaceId: string
  apiKey: string
}): string {
  const credential = createHash('sha256').update(input.apiKey).digest('hex')
  const identity = input.funding === 'managed'
    ? `managed:${input.poolId ?? input.providerId}`
    : `byok:${input.workspaceId}:${input.providerId}:${credential}`
  return createHash('sha256').update(identity).digest('hex')
}
