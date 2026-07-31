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
  type MaximumUsageEstimate,
} from '@/features/billing'
import { requireManagedCredential } from './managed-credentials'
import {
  authorizeManagedRoute,
  isManagedProvider,
  type ManagedProviderId,
} from './managed-service'
import type { AiProviderId } from './provider-registry'
import { RouteContractError } from './route-contract-error'
import {
  fundingForProvider,
  getAiConfigDependencies,
} from './config'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  createUnbilledInvocation,
  markProviderInvocationStarted,
  releaseUnbilledInvocation,
  settleUnbilledInvocation,
} from './invocation-ledger'
import {
  createManagedHandle,
  createUnbilledHandle,
  type ManagedAiHandle,
} from './invocation-handles'

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
  authorizeManagedRoute: typeof authorizeManagedRoute
  fundingForProvider: typeof fundingForProvider
  loadByokCredential: (provider: AiProviderId) => Promise<string | null>
  createUnbilledInvocation?: typeof createUnbilledInvocation
  markProviderInvocationStarted?: typeof markProviderInvocationStarted
  settleUnbilledInvocation?: typeof settleUnbilledInvocation
  releaseUnbilledInvocation?: typeof releaseUnbilledInvocation
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
  authorizeManagedRoute,
  fundingForProvider,
  loadByokCredential: (provider) =>
    getAiConfigDependencies().credentials.loadSecret(
      currentWorkspaceId(),
      provider,
    ),
  createUnbilledInvocation,
  markProviderInvocationStarted,
  settleUnbilledInvocation,
  releaseUnbilledInvocation,
}

export interface InvocationExecutionMetadata {
  operationId?: string
  attemptGroupId?: string
  logicalModelId?: string
  outboundModelId?: string
  deploymentId?: string
  channelId?: string
  adapterProtocol?: string
  officialPriceIdentity?: string
  providerPoolId?: string
  failureDomainId?: string
  planVersion?: string
  entitlementRateCardId?: string
}

interface BeginBase {
  attemptId: string
  invocationNo: number
  repairNo?: number
  provider: AiProviderId
  model: string
  rawInput: string | Uint8Array
  operation?: string
  source?: string
  execution?: InvocationExecutionMetadata
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

export type { ManagedAiHandle } from './invocation-handles'

export interface PreparedManagedAiInvocation {
  credential: string
  dispatchFunding: 'managed' | 'byok'
  begin(): Promise<ManagedAiHandle>
}

export class ManagedAiGateway {
  constructor(
    private readonly dependencies: ManagedAiGatewayDependencies =
      DEFAULT_DEPENDENCIES,
  ) {}

  async begin(input: ManagedAiBeginInput): Promise<ManagedAiHandle> {
    return (await this.prepare(input)).begin()
  }

  async prepare(input: ManagedAiBeginInput): Promise<PreparedManagedAiInvocation> {
    const plan = await this.dependencies.getCurrentPlanKey()
    const funding = await this.dependencies.fundingForProvider(input.provider)
    const logicalModelId = input.execution?.logicalModelId ?? input.model
    const authorization = await this.dependencies.authorizeManagedRoute({
      plan,
      provider: input.provider,
      modelId: logicalModelId,
      capability: input.capability,
      funding,
    })
    if (authorization.funding === 'byok') {
      const credential = await this.dependencies.loadByokCredential(input.provider)
      if (!credential) {
        throw new RouteContractError('所选供应商尚未配置自己的 API Key')
      }
      const invocationId = invocationUuid(input)
      const execution = executionMetadata(input, invocationId)
      const ledgerFunding = isManagedProvider(input.provider) ? 'byok' : 'custom'
      return {
        credential,
        dispatchFunding: 'byok',
        begin: async () => {
          await (this.dependencies.createUnbilledInvocation ?? createUnbilledInvocation)({
            invocationId,
            attemptId: input.attemptId,
            invocationNo: input.invocationNo,
            repairNo: input.repairNo,
            provider: input.provider,
            model: input.model,
            funding: ledgerFunding,
            capability: input.capability,
            operation: input.operation ?? 'workflow',
            source: input.source,
            inputHash: sha256(input.rawInput),
            ...execution,
          })
          return createUnbilledHandle({
            invocationId,
            funding: ledgerFunding,
            capability: input.capability,
            credential,
            lifecycle: {
              markStarted: this.dependencies.markProviderInvocationStarted
                ?? markProviderInvocationStarted,
              settle: this.dependencies.settleUnbilledInvocation
                ?? settleUnbilledInvocation,
              release: this.dependencies.releaseUnbilledInvocation
                ?? releaseUnbilledInvocation,
            },
          })
        },
      }
    }

    const provider = requireManagedProvider(input.provider)
    const credential = this.dependencies.requireManagedCredential(provider)
    const rateCard = await this.dependencies.getCurrentRateCard({
      catalogId: authorization.catalogId,
      provider,
      model: logicalModelId,
      capability: input.capability,
    })
    const maximumCostCnyMicros = this.dependencies.estimateMaximumCost(
      rateCard.prices,
      maximumEstimate(input),
      rateCard.pricingRules,
    )
    const inputHash = sha256(input.rawInput)
    const invocationId = invocationUuid(input)
    const execution = executionMetadata(input, invocationId)
    return {
      credential,
      dispatchFunding: 'managed',
      begin: async () => {
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
            capability: input.capability,
            operation: input.operation ?? 'workflow',
            source: input.source,
            ...execution,
          },
        })
        return createManagedHandle({
          invocationId,
          credential,
          capability: input.capability,
          prices: rateCard.prices,
          pricingRules: rateCard.pricingRules,
          lifecycle: {
            markStarted: this.dependencies.markProviderInvocationStarted
              ?? markProviderInvocationStarted,
            calculateCost: this.dependencies.calculateActualCost,
            settle: this.dependencies.settleManagedInvocation,
            release: this.dependencies.releaseManagedReservation,
          },
        })
      },
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

function requireManagedProvider(provider: AiProviderId): ManagedProviderId {
  if (isManagedProvider(provider)) return provider
  throw new RouteContractError('BYOK provider 不应进入托管预留流程')
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

function executionMetadata(
  input: ManagedAiBeginInput,
  invocationId: string,
): InvocationExecutionMetadata {
  return {
    operationId: input.execution?.operationId ?? invocationId,
    attemptGroupId: input.execution?.attemptGroupId ?? input.attemptId,
    logicalModelId: input.execution?.logicalModelId ?? input.model,
    outboundModelId: input.execution?.outboundModelId ?? input.model,
    deploymentId: input.execution?.deploymentId,
    channelId: input.execution?.channelId,
    adapterProtocol: input.execution?.adapterProtocol,
    officialPriceIdentity: input.execution?.officialPriceIdentity,
    providerPoolId: input.execution?.providerPoolId,
    failureDomainId: input.execution?.failureDomainId,
    planVersion: input.execution?.planVersion,
    entitlementRateCardId: input.execution?.entitlementRateCardId,
  }
}
