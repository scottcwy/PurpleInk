import 'server-only'
import { createHash } from 'node:crypto'
import {
  ManagedAiGateway,
  managedUpstreamError,
  type ManagedAiBeginInput,
  type ManagedAiHandle,
  type ManagedProviderId,
} from '@/features/ai'
import type { MaximumUsageEstimate } from '@/features/billing'

export interface AudioBillingContext {
  attemptId: string
  invocationNo: number
  repairNo?: number
}

export interface ManagedAudioBillingInput<T> {
  provider: ManagedProviderId
  model: string
  capability: 'tts' | 'asr'
  billingContext?: AudioBillingContext
  estimate: Extract<MaximumUsageEstimate, { kind: 'tts' | 'asr' }>
  input: string | Uint8Array
  prepare?: () => Promise<void>
  invoke: () => Promise<T>
  outputBytes: (result: T) => string | Uint8Array
  usageFromResult: (result: T) => Parameters<ManagedAiHandle['settle']>[0]
}

export interface ManagedAudioBillingDependencies {
  gateway: Pick<ManagedAiGateway, 'begin'>
}

const DEFAULT_DEPENDENCIES: ManagedAudioBillingDependencies = {
  gateway: new ManagedAiGateway(),
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
  const handle = await dependencies.gateway.begin(gatewayInput(input, context))

  try {
    await input.prepare?.()
  } catch (error) {
    await handle.releaseBeforeCall()
    throw error
  }

  let result: T
  try {
    result = await input.invoke()
  } catch (error) {
    await handle.settleUnavailable(true)
    throw managedUpstreamError(error)
  }
  const outputHash = createHash('sha256')
    .update(input.outputBytes(result))
    .digest('hex')
  await handle.settle(input.usageFromResult(result), outputHash)
  return result
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
