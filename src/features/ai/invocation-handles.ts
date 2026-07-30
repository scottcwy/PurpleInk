import 'server-only'
import type {
  BillableUsage,
  settleManagedInvocation,
} from '@/features/billing'
import type { ProviderCapability } from './provider-registry'
import type { ManagedUsage } from './managed-service'
import type { InvocationFunding } from './invocation-ledger'
import { RouteContractError } from './route-contract-error'

export interface ManagedAiHandle {
  invocationId: string | null
  funding: InvocationFunding
  deductsManagedPool: boolean
  credential: string | null
  markProviderStarted?: () => Promise<void>
  settle: (
    usage: ManagedUsage,
    outputHash?: string,
    failed?: boolean,
  ) => Promise<void>
  settleUnavailable: (failed?: boolean, failureKind?: string) => Promise<void>
  settleRejected?: (failureKind: string) => Promise<void>
  releaseBeforeCall: () => Promise<void>
}

interface Lifecycle {
  markStarted: (invocationId: string) => Promise<void>
}

export function createManagedHandle(input: {
  invocationId: string
  credential: string
  capability: ProviderCapability
  prices: Parameters<(typeof import('@/features/billing'))['calculateActualCost']>[0]
  maximumCostCnyMicros: bigint
  lifecycle: Lifecycle & {
    calculateCost: (
      prices: Parameters<(typeof import('@/features/billing'))['calculateActualCost']>[0],
      usage: BillableUsage,
    ) => bigint
    settle: typeof settleManagedInvocation
    release: (input: { invocationId: string }) => Promise<void>
  }
}): ManagedAiHandle {
  const state = terminalState()
  let startedAt: number | null = null
  return {
    invocationId: input.invocationId,
    funding: 'managed',
    deductsManagedPool: true,
    credential: input.credential,
    markProviderStarted: async () => {
      if (startedAt !== null) return
      await input.lifecycle.markStarted(input.invocationId)
      startedAt = performance.now()
    },
    settle: (usage, outputHash, failed = false) => state.once(async () => {
      validateOutputHash(outputHash)
      await input.lifecycle.settle({
        invocationId: input.invocationId,
        actualCostCnyMicros: input.lifecycle.calculateCost(
          input.prices,
          billableUsage(input.capability, usage),
        ),
        usageStatus: 'reported',
        invocationStatus: failed ? 'failed' : 'succeeded',
        outputHash,
        usage: {
          schemaVersion: 2,
          capability: input.capability,
          ...usage,
        },
        providerDurationMs: durationSince(startedAt),
      })
    }),
    settleUnavailable: (failed = false, failureKind) => state.once(() =>
      input.lifecycle.settle({
        invocationId: input.invocationId,
        actualCostCnyMicros: input.maximumCostCnyMicros,
        usageStatus: 'unavailable',
        invocationStatus: failed ? 'failed' : 'succeeded',
        usage: {
          schemaVersion: 2,
          capability: input.capability,
          unavailable: true,
        },
        providerDurationMs: durationSince(startedAt),
        failureKind,
      })),
    settleRejected: (failureKind) => state.once(() =>
      input.lifecycle.settle({
        invocationId: input.invocationId,
        actualCostCnyMicros: BigInt(0),
        usageStatus: 'reported',
        invocationStatus: 'failed',
        billingStatus: 'released',
        usage: {
          schemaVersion: 2,
          capability: input.capability,
          rejected: true,
        },
        providerDurationMs: durationSince(startedAt),
        failureKind,
      })),
    releaseBeforeCall: () => state.once(() =>
      input.lifecycle.release({ invocationId: input.invocationId })),
  }
}

export function createUnbilledHandle(input: {
  invocationId: string
  funding: Exclude<InvocationFunding, 'managed'>
  capability: ProviderCapability
  credential: string
  lifecycle: Lifecycle & {
    settle: (input: {
      invocationId: string
      status: 'succeeded' | 'failed'
      usageStatus: 'reported' | 'unavailable'
      usage: { schemaVersion: number; [key: string]: unknown }
      outputHash?: string
      providerDurationMs: number
      failureKind?: string
    }) => Promise<void>
    release: (invocationId: string) => Promise<void>
  }
}): ManagedAiHandle {
  const state = terminalState()
  let startedAt: number | null = null
  const usagePayload = (usage?: ManagedUsage) => ({
    schemaVersion: 2,
    capability: input.capability,
    ...(usage ?? { unavailable: true }),
  })
  return {
    invocationId: input.invocationId,
    funding: input.funding,
    deductsManagedPool: false,
    credential: input.credential,
    markProviderStarted: async () => {
      if (startedAt !== null) return
      await input.lifecycle.markStarted(input.invocationId)
      startedAt = performance.now()
    },
    settle: (usage, outputHash, failed = false) => state.once(() =>
      input.lifecycle.settle({
        invocationId: input.invocationId,
        status: failed ? 'failed' : 'succeeded',
        usageStatus: 'reported',
        usage: usagePayload(usage),
        outputHash,
        providerDurationMs: durationSince(startedAt),
      })),
    settleUnavailable: (failed = false, failureKind) => state.once(() =>
      input.lifecycle.settle({
        invocationId: input.invocationId,
        status: failed ? 'failed' : 'succeeded',
        usageStatus: 'unavailable',
        usage: usagePayload(),
        providerDurationMs: durationSince(startedAt),
        failureKind,
      })),
    settleRejected: (failureKind) => state.once(() =>
      input.lifecycle.settle({
        invocationId: input.invocationId,
        status: 'failed',
        usageStatus: 'reported',
        usage: {
          ...usagePayload(),
          rejected: true,
        },
        providerDurationMs: durationSince(startedAt),
        failureKind,
      })),
    releaseBeforeCall: () => state.once(() =>
      input.lifecycle.release(input.invocationId)),
  }
}

function terminalState() {
  let terminal: Promise<void> | null = null
  return {
    once(action: () => Promise<void>): Promise<void> {
      if (!terminal) {
        terminal = action().catch((error: unknown) => {
          terminal = null
          throw error
        })
      }
      return terminal
    },
  }
}

function billableUsage(
  capability: ProviderCapability,
  usage: ManagedUsage,
): BillableUsage {
  if (capability === 'tts' && usage.kind === 'tts') {
    return { kind: 'tts', characters: usage.inputCharacters }
  }
  if (capability === 'asr' && usage.kind === 'asr') {
    return { kind: 'asr', audioSeconds: usage.inputAudioSeconds }
  }
  if (
    (capability === 'text' || capability === 'vision')
    && usage.kind === 'text'
  ) {
    return { ...usage, kind: capability }
  }
  throw new RouteContractError('托管用量类型与模型能力不匹配')
}

function validateOutputHash(outputHash?: string): void {
  if (outputHash === undefined || /^[0-9a-f]{64}$/.test(outputHash)) return
  throw new RouteContractError('托管输出哈希必须是 SHA-256 十六进制')
}

function durationSince(startedAt: number | null): number {
  if (startedAt === null) {
    throw new RouteContractError('Provider 尚未标记出网，不能结算调用')
  }
  return Math.max(0, Math.round(performance.now() - startedAt))
}
