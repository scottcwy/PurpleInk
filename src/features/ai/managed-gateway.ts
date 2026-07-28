import 'server-only'
import { createHash } from 'node:crypto'
import {
  calculateActualCost,
  estimateMaximumCost,
  getCurrentPlanKey,
  getCurrentRateCard,
  releaseManagedReservation,
  reserveManagedInvocation,
  settleManagedInvocation,
  type BillableUsage,
  type MaximumUsageEstimate,
} from '@/features/billing'
import { requireManagedCredential } from './managed-credentials'
import {
  authorizeManagedRoute,
  isManagedProvider,
  type ManagedProviderId,
  type ManagedUsage,
} from './managed-service'
import type { AiProviderId, ProviderCapability } from './provider-registry'
import { RouteContractError } from './route-contract-error'

export interface ManagedAiGatewayDependencies {
  getCurrentPlanKey: typeof getCurrentPlanKey
  requireManagedCredential: (
    provider: ManagedProviderId,
    env?: NodeJS.ProcessEnv
  ) => string
  getCurrentRateCard: typeof getCurrentRateCard
  estimateMaximumCost: typeof estimateMaximumCost
  reserveManagedInvocation: typeof reserveManagedInvocation
  calculateActualCost: typeof calculateActualCost
  settleManagedInvocation: typeof settleManagedInvocation
  releaseManagedReservation: typeof releaseManagedReservation
}

const DEFAULT_DEPENDENCIES: ManagedAiGatewayDependencies = {
  getCurrentPlanKey,
  requireManagedCredential,
  getCurrentRateCard,
  estimateMaximumCost,
  reserveManagedInvocation,
  calculateActualCost,
  settleManagedInvocation,
  releaseManagedReservation,
}

interface BeginBase {
  attemptId: string
  invocationNo: number
  repairNo?: number
  provider: AiProviderId
  model: string
  rawInput: string | Uint8Array
}

export type ManagedAiBeginInput = BeginBase & (
  | {
      capability: 'text' | 'vision'
      maxOutputTokens: number
    }
  | {
      capability: 'tts'
      ttsEstimate: { characters: number }
    }
  | {
      capability: 'asr'
      asrEstimate: { audioSeconds: number }
    }
)

export interface ManagedAiHandle {
  invocationId: string | null
  funding: 'managed' | 'byok'
  deductsManagedPool: boolean
  credential: string | null
  settle: (usage: ManagedUsage, outputHash?: string) => Promise<void>
  settleUnavailable: (failed?: boolean) => Promise<void>
  releaseBeforeCall: () => Promise<void>
}

export class ManagedAiGateway {
  constructor(
    private readonly dependencies: ManagedAiGatewayDependencies =
      DEFAULT_DEPENDENCIES,
  ) {}

  async begin(input: ManagedAiBeginInput): Promise<ManagedAiHandle> {
    const plan = await this.dependencies.getCurrentPlanKey()
    const authorization = authorizeManagedRoute({
      plan,
      provider: input.provider,
      modelId: input.model,
      capability: input.capability,
    })
    if (authorization.funding === 'byok') return byokHandle()

    const provider = requireManagedProvider(input.provider)
    const credential = this.dependencies.requireManagedCredential(provider)
    const rateCard = await this.dependencies.getCurrentRateCard({
      provider,
      model: input.model,
      capability: input.capability,
    })
    const maximumCostCnyMicros = this.dependencies.estimateMaximumCost(
      rateCard.prices,
      maximumEstimate(input),
    )
    const inputHash = sha256(input.rawInput)
    const invocationId = invocationUuid(input)
    await this.dependencies.reserveManagedInvocation({
      invocationId,
      idempotencyKey: sha256([
        'managed-ai/v1',
        invocationId,
        provider,
        input.model,
        inputHash,
      ].join(':')),
      rateCardId: rateCard.id,
      maximumCostCnyMicros,
      create: {
        attemptId: input.attemptId,
        invocationNo: input.invocationNo,
        repairNo: input.repairNo,
        provider,
        model: input.model,
        inputHash,
      },
    })
    return this.managedHandle({
      input,
      invocationId,
      credential,
      prices: rateCard.prices,
    })
  }

  private managedHandle(input: {
    input: ManagedAiBeginInput
    invocationId: string
    credential: string
    prices: Parameters<typeof calculateActualCost>[0]
  }): ManagedAiHandle {
    let terminal: Promise<void> | null = null
    const once = (action: () => Promise<void>): Promise<void> => {
      if (!terminal) {
        terminal = action().catch((error: unknown) => {
          terminal = null
          throw error
        })
      }
      return terminal
    }
    return {
      invocationId: input.invocationId,
      funding: 'managed',
      deductsManagedPool: true,
      credential: input.credential,
      settle: (usage, outputHash) => once(async () => {
        validateOutputHash(outputHash)
        const billable = billableUsage(input.input.capability, usage)
        await this.dependencies.settleManagedInvocation({
          invocationId: input.invocationId,
          actualCostCnyMicros: this.dependencies.calculateActualCost(
            input.prices,
            billable,
          ),
          usageStatus: 'reported',
          invocationStatus: 'succeeded',
          outputHash,
          usage: {
            schemaVersion: 1,
            capability: input.input.capability,
            ...usage,
          },
        })
      }),
      settleUnavailable: (failed = false) => once(() =>
        this.dependencies.settleManagedInvocation({
          invocationId: input.invocationId,
          actualCostCnyMicros: BigInt(0),
          usageStatus: 'unavailable',
          invocationStatus: failed ? 'failed' : 'succeeded',
          usage: {
            schemaVersion: 1,
            capability: input.input.capability,
            unavailable: true,
          },
        })),
      releaseBeforeCall: () => once(() =>
        this.dependencies.releaseManagedReservation({
          invocationId: input.invocationId,
        })),
    }
  }
}

function maximumEstimate(input: ManagedAiBeginInput): MaximumUsageEstimate {
  if (input.capability === 'tts') {
    return { kind: 'tts', characters: input.ttsEstimate.characters }
  }
  if (input.capability === 'asr') {
    return { kind: 'asr', audioSeconds: input.asrEstimate.audioSeconds }
  }
  return {
    kind: input.capability,
    input: input.rawInput,
    maxOutputTokens: input.maxOutputTokens,
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
    (capability === 'text' || capability === 'vision') &&
    usage.kind === 'text'
  ) {
    return { ...usage, kind: capability }
  }
  throw new RouteContractError('托管用量类型与模型能力不匹配')
}

function requireManagedProvider(provider: AiProviderId): ManagedProviderId {
  if (isManagedProvider(provider)) return provider
  throw new RouteContractError('BYOK provider 不应进入托管预留流程')
}

function byokHandle(): ManagedAiHandle {
  const done = Promise.resolve()
  return {
    invocationId: null,
    funding: 'byok',
    deductsManagedPool: false,
    credential: null,
    settle: () => done,
    settleUnavailable: () => done,
    releaseBeforeCall: () => done,
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function invocationUuid(input: ManagedAiBeginInput): string {
  const bytes = createHash('sha256')
    .update([
      'managed-ai-invocation/v1',
      input.attemptId,
      input.invocationNo,
      input.repairNo ?? 0,
    ].join(':'))
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x80
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

function validateOutputHash(outputHash?: string): void {
  if (outputHash === undefined || /^[0-9a-f]{64}$/.test(outputHash)) return
  throw new RouteContractError('托管输出哈希必须是 SHA-256 十六进制')
}
