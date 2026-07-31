import 'server-only'
import { createHash } from 'node:crypto'
import {
  ManagedAiGateway,
  managedUpstreamError,
  type ManagedAiBeginInput,
  type ManagedAiHandle,
  type InvocationExecutionMetadata,
  type AiProviderId,
} from '@/features/ai'
import { ProviderQueueDeferral } from '@/features/ai/provider-queue-deferral'
import { withProviderDispatch } from '@/features/ai/provider-dispatch'
import { ProviderRequestError } from '@/features/ai/provider-request-error'
import { PROVIDER_REGISTRY } from '@/features/ai/provider-registry'
import type { MaximumUsageEstimate } from '@/features/billing'

export interface AudioBillingContext {
  attemptId: string
  invocationNo: number
  repairNo?: number
}

export interface ManagedAudioBillingInput<T> {
  provider: AiProviderId
  model: string
  providerPoolId?: string
  execution?: InvocationExecutionMetadata
  capability: 'tts' | 'asr'
  billingContext?: AudioBillingContext
  estimate: Extract<MaximumUsageEstimate, { kind: 'tts' | 'asr' }>
  input: string | Uint8Array
  prepare?: () => Promise<void>
  invoke: () => Promise<T>
  outputBytes: (result: T) => string | Uint8Array
  usageFromResult: (
    result: T,
  ) => Parameters<ManagedAiHandle['settle']>[0] | null
}

export interface ManagedAudioBillingDependencies {
  gateway: Pick<ManagedAiGateway, 'prepare'>
  dispatch: typeof withProviderDispatch
}

const DEFAULT_DEPENDENCIES: ManagedAudioBillingDependencies = {
  gateway: new ManagedAiGateway(),
  dispatch: withProviderDispatch,
}

/**
 * 托管音频的阶段适配层：统一网关负责授权、凭据、费率、哈希、预留与结算，
 * 本层只保留 prepare/provider 调用的阶段语义。
 */
export async function runManagedAudioBilling<T>(
  input: ManagedAudioBillingInput<T>,
  dependencies: ManagedAudioBillingDependencies = DEFAULT_DEPENDENCIES,
): Promise<T> {
  const context = requireBillingContext(input.billingContext)
  const prepared = await dependencies.gateway.prepare(gatewayInput(input, context))
  return dependencies.dispatch({
    providerId: input.provider,
    providerLabel: PROVIDER_REGISTRY[input.provider].label,
    funding: prepared.dispatchFunding,
    apiKey: prepared.credential,
    attemptId: context.attemptId,
    ...(input.providerPoolId ? { poolId: input.providerPoolId } : {}),
    tokenEstimate: input.estimate.kind === 'tts'
      ? input.estimate.characters
      : undefined,
  }, async () => {
  const handle = await prepared.begin()

  try {
    await input.prepare?.()
  } catch (error) {
    await handle.releaseBeforeCall()
    throw error
  }

  let result: T
  try {
    await handle.markProviderStarted?.()
    result = await input.invoke()
  } catch (error) {
    // Provider 调度等待不是上游失败：透传让队列用内置的 dispatch-wait 调度恢复，
    // 不得包装为 managedUpstreamError（会丢掉 retryAt 并消耗普通重试预算）。
    if (error instanceof ProviderQueueDeferral) throw error
    if (error instanceof ProviderRequestError && isRejectedWithoutUsage(error)) {
      if (handle.settleRejected) await handle.settleRejected(error.kind)
      else await handle.releaseBeforeCall()
      throw error
    }
    await handle.settleUnavailable(true, 'unknown')
    throw managedUpstreamError(error)
  }
  const outputHash = createHash('sha256')
    .update(input.outputBytes(result))
    .digest('hex')
  const usage = input.usageFromResult(result)
  if (usage) await handle.settle(usage, outputHash)
  else await handle.settleUnavailable()
  return result
  })
}

function isRejectedWithoutUsage(error: ProviderRequestError): boolean {
  return [
    'auth',
    'balance',
    'permission',
    'rate_limit',
    'request',
    'safety',
  ].includes(error.kind)
}

function gatewayInput<T>(
  input: ManagedAudioBillingInput<T>,
  context: AudioBillingContext,
): ManagedAiBeginInput {
  const base = {
    attemptId: context.attemptId,
    invocationNo: context.invocationNo,
    repairNo: context.repairNo,
    provider: input.provider,
    model: input.model,
    rawInput: input.input,
    execution: input.execution,
  }
  return input.capability === 'tts'
    ? {
        ...base,
        capability: 'tts',
        ttsEstimate: {
          characters: requireEstimate(input.estimate, 'tts').characters,
        },
      }
    : {
        ...base,
        capability: 'asr',
        asrEstimate: {
          audioSeconds: requireEstimate(input.estimate, 'asr').audioSeconds,
        },
      }
}

function requireEstimate<K extends 'tts' | 'asr'>(
  estimate: ManagedAudioBillingInput<unknown>['estimate'],
  kind: K,
): Extract<typeof estimate, { kind: K }> {
  if (estimate.kind === kind) {
    return estimate as Extract<typeof estimate, { kind: K }>
  }
  throw new Error(`音频计费能力与 ${estimate.kind.toUpperCase()} 估算不匹配`)
}

function requireBillingContext(
  context: AudioBillingContext | undefined,
): AudioBillingContext {
  if (
    !context
    || context.attemptId.length === 0
    || !Number.isSafeInteger(context.invocationNo)
    || context.invocationNo < 1
  ) {
    throw new Error('托管音频调用缺少可审计的 billingContext')
  }
  return context
}
