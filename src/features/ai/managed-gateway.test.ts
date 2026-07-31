import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { QuotaExhaustedError, type CurrentRateCard } from '@/features/billing'
import { managedCredentialUnavailableError } from './managed-service'
import {
  ManagedAiGateway,
  type ManagedAiGatewayDependencies,
} from './managed-gateway'

vi.mock('server-only', () => ({}))

const CARD: CurrentRateCard = {
  id: '00000000-0000-4000-8000-000000000010',
  version: 1,
  priceCurrency: 'CNY',
  fxCnyMicrosPerCurrencyUnit: BigInt(1_000_000),
  prices: [
    {
      unitKind: 'input_token',
      unitSize: BigInt(1),
      unitPriceCnyMicros: BigInt(1),
    },
    {
      unitKind: 'output_token',
      unitSize: BigInt(1),
      unitPriceCnyMicros: BigInt(2),
    },
  ],
}

function dependencies() {
  const deps: ManagedAiGatewayDependencies = {
    getCurrentPlanKey: vi.fn(async () => 'plus' as const),
    requireManagedCredential: vi.fn(() => 'managed-secret'),
    getCurrentRateCard: vi.fn(async () => CARD),
    estimateMaximumCost: vi.fn(() => BigInt(100)),
    reserveManagedInvocation: vi.fn(async () => ({
      periodId: '00000000-0000-4000-8000-000000000020',
      reservedCnyMicros: BigInt(100),
    })),
    calculateActualCost: vi.fn(() => BigInt(42)),
    settleManagedInvocation: vi.fn(async () => undefined),
    releaseManagedReservation: vi.fn(async () => undefined),
    fundingForProvider: vi.fn(async (provider) =>
      provider === 'openai-compatible' ? 'byok' as const : 'managed' as const),
    loadByokCredential: vi.fn(async () => 'workspace-secret'),
    createUnbilledInvocation: vi.fn(async () => undefined),
    markProviderInvocationStarted: vi.fn(async () => undefined),
    settleUnbilledInvocation: vi.fn(async () => undefined),
    releaseUnbilledInvocation: vi.fn(async () => undefined),
    authorizeManagedRoute: vi.fn(async (input) =>
      input.funding === 'byok'
        ? { funding: 'byok' as const, deductsManagedPool: false }
        : {
            funding: 'managed' as const,
            deductsManagedPool: true,
            catalogId: '00000000-0000-4000-8000-000000000009',
          }),
  }
  return deps
}

const TEXT_INPUT = {
  attemptId: '00000000-0000-4000-8000-000000000001',
  invocationNo: 2,
  repairNo: 1,
  provider: 'stepfun',
  model: 'step-3.5-flash',
  capability: 'text',
  rawInput: '不得持久化的中文 prompt',
  maxOutputTokens: 200,
} as const

describe('ManagedAiGateway', () => {
  it('consumes a resolved execution plan without resolving route or credential again', async () => {
    const deps = dependencies()
    const handle = await new ManagedAiGateway(deps).begin({
      ...TEXT_INPUT,
      provider: 'openai',
      model: 'openai/gpt-5.6-luna',
      resolvedPlan: {
        schemaVersion: 2,
        kind: 'built-in',
        providerId: 'openai',
        fundingSource: 'managed',
        logicalModelId: 'gpt-5.6-luna',
        outboundModelId: 'openai/gpt-5.6-luna',
        deploymentId: 'openai.gpt-5.6-luna.managed',
        channelId: 'openai.openrouter',
        adapterProtocol: 'openai-completions',
        baseUrl: 'https://openrouter.ai/api/v1',
        officialPriceIdentity: 'openai.gpt-5.6-luna',
        providerPoolId: 'openai.openrouter',
        failureDomainId: 'openai.openrouter',
        capability: 'text',
        catalogId: '00000000-0000-4000-8000-000000000009',
        planVersion: '2026-07-31.1',
        credentialLease: {
          source: 'managed',
          reference: 'CVC_MANAGED_OPENAI_API_KEY',
          version: '2026-07-31.1',
          credential: 'frozen-managed-secret',
        },
      },
    })

    expect(handle.credential).toBe('frozen-managed-secret')
    expect(deps.getCurrentPlanKey).not.toHaveBeenCalled()
    expect(deps.fundingForProvider).not.toHaveBeenCalled()
    expect(deps.authorizeManagedRoute).not.toHaveBeenCalled()
    expect(deps.requireManagedCredential).not.toHaveBeenCalled()
    expect(deps.loadByokCredential).not.toHaveBeenCalled()
    expect(deps.getCurrentRateCard).toHaveBeenCalledWith({
      catalogId: '00000000-0000-4000-8000-000000000009',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      capability: 'text',
    })
  })

  it('authorizes and prices the logical model while preserving the outbound model', async () => {
    const deps = dependencies()
    await new ManagedAiGateway(deps).begin({
      ...TEXT_INPUT,
      provider: 'openai',
      model: 'openai/gpt-5.6-luna',
      execution: {
        logicalModelId: 'gpt-5.6-luna',
        outboundModelId: 'openai/gpt-5.6-luna',
        deploymentId: 'openai.gpt-5.6-luna.managed',
        officialPriceIdentity: 'openai.gpt-5.6-luna',
      },
    })

    expect(deps.authorizeManagedRoute).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'gpt-5.6-luna' }),
    )
    expect(deps.getCurrentRateCard).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.6-luna' }),
    )
    expect(deps.reserveManagedInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          model: 'openai/gpt-5.6-luna',
          logicalModelId: 'gpt-5.6-luna',
          outboundModelId: 'openai/gpt-5.6-luna',
        }),
      }),
    )
  })

  it('returns a BYOK handle without touching managed credentials or billing', async () => {
    const deps = dependencies()
    const gateway = new ManagedAiGateway(deps)

    const handle = await gateway.begin({
      ...TEXT_INPUT,
      provider: 'openai-compatible',
      model: 'user-model',
    })
    await handle.markProviderStarted?.()
    await handle.settle({
      kind: 'text',
      inputTokens: 10,
      outputTokens: 5,
    })

    expect(handle).toMatchObject({
      funding: 'custom',
      deductsManagedPool: false,
      credential: 'workspace-secret',
    })
    expect(deps.requireManagedCredential).not.toHaveBeenCalled()
    expect(deps.loadByokCredential).toHaveBeenCalled()
    expect(deps.getCurrentRateCard).not.toHaveBeenCalled()
    expect(deps.reserveManagedInvocation).not.toHaveBeenCalled()
    expect(deps.settleManagedInvocation).not.toHaveBeenCalled()
    expect(deps.createUnbilledInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ funding: 'custom', capability: 'text' }),
    )
    expect(deps.settleUnbilledInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded', usageStatus: 'reported' }),
    )
  })

  it('lets Free Gemini BYOK bypass managed credentials and the cost pool', async () => {
    const deps = dependencies()
    vi.mocked(deps.getCurrentPlanKey).mockResolvedValue('free')
    vi.mocked(deps.fundingForProvider).mockResolvedValue('byok')
    vi.mocked(deps.loadByokCredential).mockResolvedValue('user-gemini-key')

    const handle = await new ManagedAiGateway(deps).begin({
      ...TEXT_INPUT,
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
    })

    expect(handle).toMatchObject({
      funding: 'byok',
      deductsManagedPool: false,
      credential: 'user-gemini-key',
      invocationId: expect.any(String),
    })
    expect(deps.requireManagedCredential).not.toHaveBeenCalled()
    expect(deps.reserveManagedInvocation).not.toHaveBeenCalled()
  })

  it('does not reserve when the managed credential is unavailable', async () => {
    const deps = dependencies()
    vi.mocked(deps.requireManagedCredential).mockImplementation(() => {
      throw managedCredentialUnavailableError()
    })

    await expect(new ManagedAiGateway(deps).begin(TEXT_INPUT)).rejects.toMatchObject({
      code: 'MANAGED_CREDENTIAL_UNAVAILABLE',
    })
    expect(deps.getCurrentRateCard).not.toHaveBeenCalled()
    expect(deps.reserveManagedInvocation).not.toHaveBeenCalled()
  })

  it('hashes raw input and reserves before returning a managed handle', async () => {
    const deps = dependencies()
    const handle = await new ManagedAiGateway(deps).begin(TEXT_INPUT)
    const expectedHash = createHash('sha256')
      .update(TEXT_INPUT.rawInput, 'utf8')
      .digest('hex')

    expect(deps.getCurrentRateCard).toHaveBeenCalledWith({
      catalogId: '00000000-0000-4000-8000-000000000009',
      provider: 'stepfun',
      model: 'step-3.5-flash',
      capability: 'text',
    })
    expect(deps.estimateMaximumCost).toHaveBeenCalledWith(CARD.prices, {
      kind: 'text',
      input: TEXT_INPUT.rawInput,
      maxOutputTokens: 200,
    }, undefined)
    expect(deps.reserveManagedInvocation).toHaveBeenCalledWith({
      invocationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      rateCardId: CARD.id,
      maximumCostCnyMicros: BigInt(100),
      create: {
        attemptId: TEXT_INPUT.attemptId,
        invocationNo: 2,
        repairNo: 1,
        provider: 'stepfun',
        model: 'step-3.5-flash',
        inputHash: expectedHash,
        capability: 'text',
        operation: 'workflow',
        source: undefined,
        operationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        attemptGroupId: TEXT_INPUT.attemptId,
        logicalModelId: 'step-3.5-flash',
        outboundModelId: 'step-3.5-flash',
        deploymentId: undefined,
        channelId: undefined,
        adapterProtocol: undefined,
        officialPriceIdentity: undefined,
        providerPoolId: undefined,
        failureDomainId: undefined,
        planVersion: undefined,
        entitlementRateCardId: undefined,
      },
    })
    const reservation = vi.mocked(deps.reserveManagedInvocation).mock.calls[0]![0]
    expect(JSON.stringify(reservation.create))
      .not.toContain(TEXT_INPUT.rawInput)
    expect(handle).toMatchObject({
      funding: 'managed',
      deductsManagedPool: true,
      credential: 'managed-secret',
    })
  })

  it('propagates quota exhaustion before a provider call can start', async () => {
    const deps = dependencies()
    vi.mocked(deps.reserveManagedInvocation).mockRejectedValue(
      new QuotaExhaustedError('2026-08-01T00:00:00.000Z'),
    )

    await expect(new ManagedAiGateway(deps).begin(TEXT_INPUT)).rejects.toMatchObject({
      code: 'quota_exhausted',
    })
    expect(deps.settleManagedInvocation).not.toHaveBeenCalled()
  })

  it('uses native TTS/ASR estimates and keeps zero-cost calls on the audit path', async () => {
    const ttsDeps = dependencies()
    vi.mocked(ttsDeps.estimateMaximumCost).mockReturnValue(BigInt(0))
    await new ManagedAiGateway(ttsDeps).begin({
      attemptId: TEXT_INPUT.attemptId,
      invocationNo: 3,
      provider: 'stepfun',
      model: 'stepaudio-2.5-tts',
      capability: 'tts',
      rawInput: '十二个字符',
      ttsEstimate: { characters: 6 },
    })
    expect(ttsDeps.estimateMaximumCost).toHaveBeenCalledWith(CARD.prices, {
      kind: 'tts',
      characters: 6,
    }, undefined)
    expect(ttsDeps.reserveManagedInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ maximumCostCnyMicros: BigInt(0) }),
    )

    const asrDeps = dependencies()
    await new ManagedAiGateway(asrDeps).begin({
      attemptId: TEXT_INPUT.attemptId,
      invocationNo: 4,
      provider: 'stepfun',
      model: 'stepaudio-2.5-asr',
      capability: 'asr',
      rawInput: new Uint8Array([1, 2, 3]),
      asrEstimate: { audioSeconds: 12.5 },
    })
    expect(asrDeps.estimateMaximumCost).toHaveBeenCalledWith(CARD.prices, {
      kind: 'asr',
      audioSeconds: 12.5,
    }, undefined)
  })

  it('settles reported usage once with schema version and safe hashes', async () => {
    const deps = dependencies()
    const handle = await new ManagedAiGateway(deps).begin(TEXT_INPUT)
    await handle.markProviderStarted?.()
    const usage = {
      kind: 'text',
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
    } as const

    await Promise.all([
      handle.settle(usage, 'a'.repeat(64)),
      handle.settle(usage, 'a'.repeat(64)),
    ])

    expect(deps.calculateActualCost).toHaveBeenCalledWith(CARD.prices, {
      ...usage,
      kind: 'text',
    }, undefined)
    expect(deps.settleManagedInvocation).toHaveBeenCalledTimes(1)
    expect(deps.settleManagedInvocation).toHaveBeenCalledWith({
      invocationId: handle.invocationId,
      actualCostCnyMicros: BigInt(42),
      usageStatus: 'reported',
      measurementQuality: 'reported',
      invocationStatus: 'succeeded',
      outputHash: 'a'.repeat(64),
      usage: {
        schemaVersion: 2,
        capability: 'text',
        ...usage,
      },
      providerDurationMs: expect.any(Number),
    })
  })

  it('settles unavailable usage fully or releases before the provider call', async () => {
    const successfulDeps = dependencies()
    const successful = await new ManagedAiGateway(successfulDeps).begin(TEXT_INPUT)
    await successful.markProviderStarted?.()
    await successful.settleUnavailable()
    expect(successfulDeps.settleManagedInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        actualCostCnyMicros: BigInt(0),
        billingStatus: 'released',
        measurementQuality: 'uncertain',
        invocationStatus: 'succeeded',
      }),
    )

    const failedDeps = dependencies()
    const failed = await new ManagedAiGateway(failedDeps).begin(TEXT_INPUT)
    await failed.markProviderStarted?.()
    await failed.settleUnavailable(true)
    expect(failedDeps.settleManagedInvocation).toHaveBeenCalledWith({
      invocationId: failed.invocationId,
      actualCostCnyMicros: BigInt(0),
      usageStatus: 'unavailable',
      measurementQuality: 'uncertain',
      invocationStatus: 'failed',
      billingStatus: 'released',
      usage: { schemaVersion: 2, capability: 'text', unavailable: true },
      providerDurationMs: expect.any(Number),
      failureKind: undefined,
    })

    const releasedDeps = dependencies()
    const released = await new ManagedAiGateway(releasedDeps).begin(TEXT_INPUT)
    await released.releaseBeforeCall()
    await released.settleUnavailable(true)
    expect(releasedDeps.releaseManagedReservation).toHaveBeenCalledTimes(1)
    expect(releasedDeps.settleManagedInvocation).not.toHaveBeenCalled()
  })
})
