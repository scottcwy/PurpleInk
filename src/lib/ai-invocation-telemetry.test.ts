import { describe, expect, it } from 'vitest'
import { aiInvocationTelemetryVersion } from './ai-invocation-telemetry'

const COMPLETE_IDENTITY = {
  logicalModelId: 'gpt-5.6-luna',
  outboundModelId: 'openai/gpt-5.6-luna',
  deploymentId: 'openai.gpt-5.6-luna.managed',
  channelId: 'openai.openrouter',
  adapterProtocol: 'openai-completions',
  officialPriceIdentity: 'openai.gpt-5.6-luna',
  providerPoolId: 'openai.openrouter',
  failureDomainId: 'openai.openrouter',
  planVersion: '2026-08-01.1',
}

describe('AI invocation telemetry cutover', () => {
  it('uses v3 only when every immutable route identity is present', () => {
    expect(aiInvocationTelemetryVersion(COMPLETE_IDENTITY)).toBe(3)
    expect(aiInvocationTelemetryVersion({
      ...COMPLETE_IDENTITY,
      outboundModelId: '  ',
    })).toBe(2)
  })
})
