import { describe, expect, it, vi } from 'vitest'
import {
  resolveExecutionPlan,
  shouldUseGeminiModelFallback,
} from './execution-plan'

vi.mock('server-only', () => ({}))

const baseInput = {
  operationId: 'operation-1',
  attemptGroupId: 'attempt-group-1',
  workspaceId: 'workspace-1',
  workload: 'project-plan',
  capability: 'text' as const,
}

describe('resolveExecutionPlan', () => {
  it('resolves managed OpenAI through OpenRouter with official pricing', async () => {
    const resolved = await resolveExecutionPlan({
      ...baseInput,
      providerId: 'openai',
      fundingSource: 'managed',
      planKey: 'pro',
    }, {
      env: { CVC_MANAGED_OPENAI_API_KEY: 'managed-openai-key' },
      loadByokCredential: vi.fn(),
      now: new Date('2026-07-31T12:00:00.000Z'),
    })

    expect(resolved.plan).toMatchObject({
      providerId: 'openai',
      fundingSource: 'managed',
      logicalModelId: 'gpt-5.6-luna',
      deploymentId: 'openai.gpt-5.6-luna.managed',
      outboundModelId: 'openai/gpt-5.6-luna',
      officialPriceIdentity: 'openai.gpt-5.6-luna',
      channelId: 'openai.openrouter',
      adapterProtocol: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
      providerPoolId: 'openai.openrouter',
      failureDomainId: 'openai.openrouter',
      officialRateCardId: 'openai.gpt-5.6-luna.v1',
      entitlementRateCardId: 'ai.text.v1',
      planVersion: '2026-07-31.1',
    })
    expect(resolved.credential).toBe('managed-openai-key')
    expect(Object.isFrozen(resolved.plan)).toBe(true)
  })

  it('resolves Anthropic BYOK only through the official Messages API', async () => {
    const loadByokCredential = vi.fn(async () => 'workspace-anthropic-key')
    const resolved = await resolveExecutionPlan({
      ...baseInput,
      providerId: 'anthropic',
      fundingSource: 'byok',
      planKey: 'free',
    }, {
      env: { CVC_MANAGED_ANTHROPIC_API_KEY: 'must-not-be-read' },
      loadByokCredential,
      now: new Date('2026-07-31T12:00:00.000Z'),
    })

    expect(resolved.plan).toMatchObject({
      deploymentId: 'anthropic.claude-sonnet-5.byok',
      outboundModelId: 'claude-sonnet-5',
      adapterProtocol: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com/v1',
      fundingSource: 'byok',
    })
    expect(resolved.plan).not.toHaveProperty('officialRateCardId')
    expect(resolved.plan).not.toHaveProperty('entitlementRateCardId')
    expect(resolved.credential).toBe('workspace-anthropic-key')
    expect(loadByokCredential).toHaveBeenCalledWith(
      'workspace-1',
      'anthropic',
    )
  })

  it('rejects managed providers outside the frozen plan entitlement', async () => {
    await expect(resolveExecutionPlan({
      ...baseInput,
      providerId: 'openai',
      fundingSource: 'managed',
      planKey: 'free',
    }, {
      env: { CVC_MANAGED_OPENAI_API_KEY: 'managed-openai-key' },
      loadByokCredential: vi.fn(),
      now: new Date('2026-07-31T12:00:00.000Z'),
    })).rejects.toMatchObject({
      code: 'MANAGED_MODEL_NOT_AUTHORIZED',
      status: 403,
      retryable: false,
    })
  })

  it('binds managed Gemini to one same-channel fallback deployment', async () => {
    const resolved = await resolveExecutionPlan({
      ...baseInput,
      providerId: 'gemini',
      fundingSource: 'managed',
      planKey: 'plus',
    }, {
      env: { CVC_MANAGED_GEMINI_API_KEY: 'managed-gemini-key' },
      loadByokCredential: vi.fn(),
      now: new Date('2026-07-31T12:00:00.000Z'),
    })

    expect(resolved.plan).toMatchObject({
      deploymentId: 'gemini.3.6-flash.managed',
      outboundModelId: 'gemini-3.6-flash-tiered',
      fallbackDeploymentId: 'gemini.3.1-flash-lite.managed',
      failureDomainId: 'gemini.bcai',
    })
  })
})

describe('Gemini model fallback policy', () => {
  it.each([
    'rate_limit',
    'upstream_unavailable',
    'network',
    'timeout',
  ] as const)('allows the %s failure class', (failureKind) => {
    expect(shouldUseGeminiModelFallback({
      providerId: 'gemini',
      fundingSource: 'managed',
      fallbackDeploymentId: 'gemini.3.1-flash-lite.managed',
    }, failureKind)).toBe(true)
  })

  it.each([
    'authentication',
    'configuration',
    'quota',
    'input_contract',
    'content',
    'unknown',
  ] as const)('rejects the %s failure class', (failureKind) => {
    expect(shouldUseGeminiModelFallback({
      providerId: 'gemini',
      fundingSource: 'managed',
      fallbackDeploymentId: 'gemini.3.1-flash-lite.managed',
    }, failureKind)).toBe(false)
  })

  it('never applies relay fallback to BYOK', () => {
    expect(shouldUseGeminiModelFallback({
      providerId: 'gemini',
      fundingSource: 'byok',
      fallbackDeploymentId: 'gemini.3.1-flash-lite.managed',
    }, 'timeout')).toBe(false)
  })
})
