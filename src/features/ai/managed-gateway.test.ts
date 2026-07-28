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
  it('returns a BYOK handle without touching managed credentials or billing', async () => {
    const deps = dependencies()
    const gateway = new ManagedAiGateway(deps)

    const handle = await gateway.begin({
      ...TEXT_INPUT,
      provider: 'openai-compatible',
      model: 'user-model',
    })
    await handle.settle({
      kind: 'text',
      inputTokens: 10,
      outputTokens: 5,
    })

    expect(handle).toMatchObject({
      funding: 'byok',
      deductsManagedPool: false,
      credential: null,
    })
    expect(deps.requireManagedCredential).not.toHaveBeenCalled()
    expect(deps.getCurrentRateCard).not.toHaveBeenCalled()
    expect(deps.reserveManagedInvocation).not.toHaveBeenCalled()
    expect(deps.settleManagedInvocation).not.toHaveBeenCalled()
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
      provider: 'stepfun',
      model: 'step-3.5-flash',
      capability: 'text',
    })
    expect(deps.estimateMaximumCost).toHaveBeenCalledWith(CARD.prices, {
      kind: 'text',
      input: TEXT_INPUT.rawInput,
      maxOutputTokens: 200,
    })
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
    })
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
    })
  })

  it('settles reported usage once with schema version and safe hashes', async () => {
    const deps = dependencies()
    const handle = await new ManagedAiGateway(deps).begin(TEXT_INPUT)
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
    })
    expect(deps.settleManagedInvocation).toHaveBeenCalledTimes(1)
    expect(deps.settleManagedInvocation).toHaveBeenCalledWith({
      invocationId: handle.invocationId,
      actualCostCnyMicros: BigInt(42),
      usageStatus: 'reported',
      invocationStatus: 'succeeded',
      outputHash: 'a'.repeat(64),
      usage: {
        schemaVersion: 1,
        capability: 'text',
        ...usage,
      },
    })
  })

  it('settles unavailable usage fully or releases before the provider call', async () => {
    const successfulDeps = dependencies()
    const successful = await new ManagedAiGateway(successfulDeps).begin(TEXT_INPUT)
    await successful.settleUnavailable()
    expect(successfulDeps.settleManagedInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ invocationStatus: 'succeeded' }),
    )

    const failedDeps = dependencies()
    const failed = await new ManagedAiGateway(failedDeps).begin(TEXT_INPUT)
    await failed.settleUnavailable(true)
    expect(failedDeps.settleManagedInvocation).toHaveBeenCalledWith({
      invocationId: failed.invocationId,
      actualCostCnyMicros: BigInt(0),
      usageStatus: 'unavailable',
      invocationStatus: 'failed',
      usage: { schemaVersion: 1, capability: 'text', unavailable: true },
    })

    const releasedDeps = dependencies()
    const released = await new ManagedAiGateway(releasedDeps).begin(TEXT_INPUT)
    await released.releaseBeforeCall()
    await released.settleUnavailable(true)
    expect(releasedDeps.releaseManagedReservation).toHaveBeenCalledTimes(1)
    expect(releasedDeps.settleManagedInvocation).not.toHaveBeenCalled()
  })
})
