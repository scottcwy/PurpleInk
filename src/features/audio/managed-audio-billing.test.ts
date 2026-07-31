import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ProviderRequestError } from '@/features/ai/provider-request-error'
import { QuotaExhaustedError } from '@/features/billing'
import type { ManagedAiHandle } from '@/features/ai'
import {
  runManagedAudioBilling,
  type ManagedAudioBillingDependencies,
  type ManagedAudioInvocationRoute,
} from './managed-audio-billing'

vi.mock('server-only', () => ({}))

function createDependencies(overrides: Partial<ManagedAiHandle> = {}) {
  const handle: ManagedAiHandle = {
    invocationId: '00000000-0000-8000-8000-000000000001',
    funding: 'managed',
    deductsManagedPool: true,
    credential: 'managed-secret',
    settle: vi.fn(async () => undefined),
    settleUnavailable: vi.fn(async () => undefined),
    settleRejected: vi.fn(async () => undefined),
    releaseBeforeCall: vi.fn(async () => undefined),
    ...overrides,
  }
  const dependencies: ManagedAudioBillingDependencies = {
    gateway: {
      prepare: vi.fn(async () => ({
        credential: 'managed-secret',
        dispatchFunding: 'managed' as const,
        begin: vi.fn(async () => handle),
      })),
    },
    dispatch: async (_input, invoke) => invoke(),
  }
  return { dependencies, handle }
}

const CONTEXT = {
  attemptId: '00000000-0000-4000-8000-000000000001',
  invocationNo: 1,
}

describe('managed audio billing adapter', () => {
  it('does not call the provider when gateway reservation rejects the request', async () => {
    const invoke = vi.fn(async () => Buffer.from('audio'))
    const { dependencies, handle } = createDependencies()
    vi.mocked(dependencies.gateway.prepare).mockRejectedValue(
      new QuotaExhaustedError('2026-08-28T00:00:00.000Z'),
    )

    await expect(runManagedAudioBilling({
      provider: 'stepfun',
      model: 'stepaudio-2.5-tts',
      capability: 'tts',
      billingContext: CONTEXT,
      estimate: { kind: 'tts', characters: 4 },
      input: '真实旁白',
      invoke,
      outputBytes: (bytes) => bytes,
      usageFromResult: () => ({
        kind: 'tts', inputCharacters: 4, outputAudioSeconds: 1,
      }),
    }, dependencies)).rejects.toBeInstanceOf(QuotaExhaustedError)

    expect(invoke).not.toHaveBeenCalled()
    expect(handle.settleUnavailable).not.toHaveBeenCalled()
  })

  it('maps TTS and zero-cost MiMo calls to the unified gateway audit path', async () => {
    const { dependencies, handle } = createDependencies()

    await expect(runManagedAudioBilling({
      provider: 'mimo',
      model: 'mimo-v2.5-tts',
      capability: 'tts',
      billingContext: { ...CONTEXT, invocationNo: 2 },
      estimate: { kind: 'tts', characters: 2 },
      input: '旁白',
      invoke: vi.fn(async () => Buffer.from('audio')),
      outputBytes: (bytes) => bytes,
      usageFromResult: () => ({
        kind: 'tts', inputCharacters: 2, outputAudioSeconds: 1.5,
      }),
    }, dependencies)).resolves.toEqual(Buffer.from('audio'))

    expect(dependencies.gateway.prepare).toHaveBeenCalledWith({
      attemptId: CONTEXT.attemptId,
      invocationNo: 2,
      provider: 'mimo',
      model: 'mimo-v2.5-tts',
      capability: 'tts',
      rawInput: '旁白',
      ttsEstimate: { characters: 2 },
    })
    expect(handle.settle).toHaveBeenCalledWith({
      kind: 'tts',
      inputCharacters: 2,
      outputAudioSeconds: 1.5,
    }, createHash('sha256').update('audio').digest('hex'))
    expect(handle.settleUnavailable).not.toHaveBeenCalled()
  })

  it('passes a frozen route plan to the gateway without rebuilding it', async () => {
    const { dependencies } = createDependencies()
    const resolvedPlan = {
      schemaVersion: 2 as const,
      kind: 'built-in' as const,
      providerId: 'mimo' as const,
      fundingSource: 'byok' as const,
      logicalModelId: 'mimo-v2.5-tts',
      outboundModelId: 'mimo-v2.5-tts',
      deploymentId: 'mimo.v2.5-tts.byok',
      channelId: 'mimo.official-byok',
      adapterProtocol: 'openai-completions' as const,
      baseUrl: 'https://api.xiaomimimo.com/v1',
      officialPriceIdentity: 'xiaomi.mimo-v2.5-tts',
      providerPoolId: 'workspace:mimo',
      failureDomainId: 'workspace:mimo',
      capability: 'tts' as const,
      planVersion: '2026-07-31.1',
      credentialLease: {
        source: 'byok' as const,
        reference: 'workspace-credential',
        version: '2026-07-31.1',
        credential: 'workspace-key',
      },
    }
    const invoke = vi.fn(async (route: ManagedAudioInvocationRoute) =>
      Buffer.from(route.credential))

    await runManagedAudioBilling({
      provider: 'mimo',
      model: 'mimo-v2.5-tts',
      resolvedPlan,
      capability: 'tts',
      billingContext: { ...CONTEXT, invocationNo: 5 },
      estimate: { kind: 'tts', characters: 2 },
      input: '旁白',
      invoke,
      outputBytes: (bytes) => bytes,
      usageFromResult: () => ({
        kind: 'tts', inputCharacters: 2, outputAudioSeconds: 1,
      }),
    }, dependencies)

    expect(dependencies.gateway.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedPlan }),
    )
    expect(invoke).toHaveBeenCalledWith({
      credential: 'workspace-key',
      resolvedPlan,
    })
  })

  it('settles provider failures as unavailable and exposes only the safe error', async () => {
    const { dependencies, handle } = createDependencies()

    await expect(runManagedAudioBilling({
      provider: 'stepfun',
      model: 'stepaudio-2.5-tts',
      capability: 'tts',
      billingContext: { ...CONTEXT, invocationNo: 3 },
      estimate: { kind: 'tts', characters: 2 },
      input: '旁白',
      invoke: vi.fn(async () => {
        throw new Error('raw provider body')
      }),
      outputBytes: (bytes: Buffer) => bytes,
      usageFromResult: () => ({
        kind: 'tts', inputCharacters: 2, outputAudioSeconds: 1,
      }),
    }, dependencies)).rejects.toMatchObject({
      code: 'MANAGED_UPSTREAM_FAILED',
      message: '托管 AI 服务本次执行失败，请稍后重试',
    })

    expect(handle.settleUnavailable).toHaveBeenCalledWith(true, 'unknown')
  })

  it('preserves a structured provider timeout and its ledger failure kind', async () => {
    const { dependencies, handle } = createDependencies()
    const timeout = new ProviderRequestError({
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      operation: '语音合成',
      funding: 'managed',
      kind: 'timeout',
    })

    await expect(runManagedAudioBilling({
      provider: 'stepfun',
      model: 'stepaudio-2.5-tts',
      capability: 'tts',
      billingContext: { ...CONTEXT, invocationNo: 4 },
      estimate: { kind: 'tts', characters: 2 },
      input: '旁白',
      invoke: vi.fn(async () => { throw timeout }),
      outputBytes: (bytes: Buffer) => bytes,
      usageFromResult: () => null,
    }, dependencies)).rejects.toBe(timeout)

    expect(handle.settleUnavailable).toHaveBeenCalledWith(true, 'timeout')
  })

  it('releases the gateway reservation when preparation fails before invocation', async () => {
    const { dependencies, handle } = createDependencies()
    const invoke = vi.fn(async () => Buffer.from('audio'))

    await expect(runManagedAudioBilling({
      provider: 'stepfun',
      model: 'stepaudio-2.5-tts',
      capability: 'tts',
      billingContext: { ...CONTEXT, invocationNo: 4 },
      estimate: { kind: 'tts', characters: 2 },
      input: '旁白',
      prepare: vi.fn(async () => {
        throw new Error('prepare failed')
      }),
      invoke,
      outputBytes: (bytes) => bytes,
      usageFromResult: () => ({
        kind: 'tts', inputCharacters: 2, outputAudioSeconds: 1,
      }),
    }, dependencies)).rejects.toThrow('prepare failed')

    expect(invoke).not.toHaveBeenCalled()
    expect(handle.releaseBeforeCall).toHaveBeenCalledOnce()
    expect(handle.settleUnavailable).not.toHaveBeenCalled()
  })

  it('maps measured ASR seconds to the unified gateway', async () => {
    const { dependencies, handle } = createDependencies()
    const audio = Buffer.from('audio')

    await runManagedAudioBilling({
      provider: 'mimo',
      model: 'mimo-v2.5-asr',
      capability: 'asr',
      billingContext: { ...CONTEXT, invocationNo: 100 },
      estimate: { kind: 'asr', audioSeconds: 1.25 },
      input: audio,
      invoke: vi.fn(async () => '转写'),
      outputBytes: (transcript) => transcript,
      usageFromResult: () => ({
        kind: 'asr', inputAudioSeconds: 1.25,
      }),
    }, dependencies)

    expect(dependencies.gateway.prepare).toHaveBeenCalledWith({
      attemptId: CONTEXT.attemptId,
      invocationNo: 100,
      provider: 'mimo',
      model: 'mimo-v2.5-asr',
      capability: 'asr',
      rawInput: audio,
      asrEstimate: { audioSeconds: 1.25 },
    })
    expect(handle.settle).toHaveBeenCalledWith({
      kind: 'asr',
      inputAudioSeconds: 1.25,
    }, createHash('sha256').update('转写').digest('hex'))
  })
})
