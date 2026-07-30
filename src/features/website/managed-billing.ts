import 'server-only'
import {
  assertBillingCapacity,
  calculateActualCost,
  estimateMaximumCost,
  getCurrentRateCard,
  markManagedInvocationStarted,
  releaseManagedReservation,
  reserveManagedInvocation,
  settleManagedInvocation,
  wholeVideoSeconds,
  type CurrentRateCard,
  type ManagedInvocationReservation,
} from '@/features/billing'
import {
  createWebsiteBillingIdentity,
  requireWebsiteBillingContext,
  validateWebsiteOutputHash,
  type WebsiteBillingIdentity,
} from './managed-billing-identity'
import {
  releaseWebsiteReservation,
  settleWebsiteUsageUnavailable,
  websiteBillingScope,
} from './managed-billing-lifecycle'

const WEBSITE_PROVIDER = 'purpleink-engine'
const WEBSITE_MODEL = 'website-video-v1'
const WEBSITE_CAPABILITY = 'workflow'
const WEBSITE_OPERATION = 'website-video'

export interface WebsiteBillingCapacityDependencies {
  getCurrentRateCard: typeof getCurrentRateCard
  estimateMaximumCost: typeof estimateMaximumCost
  assertBillingCapacity: typeof assertBillingCapacity
}

const CAPACITY_DEPENDENCIES: WebsiteBillingCapacityDependencies = {
  getCurrentRateCard,
  estimateMaximumCost,
  assertBillingCapacity,
}

export interface WebsiteBillingCompletion {
  durationSec: number | null
  durationSource: 'output' | 'request' | null
  outputHash?: string
}

export interface ManagedWebsiteBillingInput<T> {
  workspaceId?: string
  attemptId: string
  invocationNo: number
  requestIdentity: string | Uint8Array
  maximumDurationSeconds: number
  invoke: () => Promise<T>
  completion: (result: T) => WebsiteBillingCompletion
}

export interface ManagedWebsiteBillingDependencies {
  getCurrentRateCard: typeof getCurrentRateCard
  estimateMaximumCost: typeof estimateMaximumCost
  reserveManagedInvocation: typeof reserveManagedInvocation
  markManagedInvocationStarted: typeof markManagedInvocationStarted
  calculateActualCost: typeof calculateActualCost
  settleManagedInvocation: typeof settleManagedInvocation
  releaseManagedReservation: typeof releaseManagedReservation
  monotonicNow: () => number
}

const DEFAULT_DEPENDENCIES: ManagedWebsiteBillingDependencies = {
  getCurrentRateCard,
  estimateMaximumCost,
  reserveManagedInvocation,
  markManagedInvocationStarted,
  calculateActualCost,
  settleManagedInvocation,
  releaseManagedReservation,
  monotonicNow: () => performance.now(),
}

export async function assertWebsiteBillingCapacity(
  maximumDurationSeconds: number,
  dependencies: WebsiteBillingCapacityDependencies = CAPACITY_DEPENDENCIES,
): Promise<void> {
  const maximumSeconds = wholeVideoSeconds(maximumDurationSeconds)
  if (maximumSeconds === 0) {
    throw new Error('Website video maximum duration must be positive')
  }
  const rateCard = await dependencies.getCurrentRateCard({
    provider: WEBSITE_PROVIDER,
    model: WEBSITE_MODEL,
    capability: WEBSITE_CAPABILITY,
  })
  const maximumCostCnyMicros = dependencies.estimateMaximumCost(
    rateCard.prices,
    { kind: 'workflow', videoSeconds: maximumSeconds },
  )
  await dependencies.assertBillingCapacity(maximumCostCnyMicros)
}

/**
 * 网站介绍视频是一个托管复合服务。它只复用现有计费账本，不进入 AI provider
 * 路由，也不读取任何供应商凭据。
 */
export async function runManagedWebsiteBilling<T>(
  input: ManagedWebsiteBillingInput<T>,
  dependencies: ManagedWebsiteBillingDependencies = DEFAULT_DEPENDENCIES,
): Promise<T> {
  requireWebsiteBillingContext(input)
  const maximumSeconds = wholeVideoSeconds(input.maximumDurationSeconds)
  if (maximumSeconds === 0) throw new Error('网站视频最大时长必须大于零')

  const rateCard = await dependencies.getCurrentRateCard({
    provider: WEBSITE_PROVIDER,
    model: WEBSITE_MODEL,
    capability: WEBSITE_CAPABILITY,
  })
  const maximumCostCnyMicros = dependencies.estimateMaximumCost(
    rateCard.prices,
    { kind: 'workflow', videoSeconds: maximumSeconds },
  )
  const identity = createWebsiteBillingIdentity({
    attemptId: input.attemptId,
    invocationNo: input.invocationNo,
    requestIdentity: input.requestIdentity,
    maximumSeconds,
  })
  await dependencies.reserveManagedInvocation(
    reservation(input, identity, rateCard, maximumCostCnyMicros),
  )

  try {
    await dependencies.markManagedInvocationStarted(websiteBillingScope(
      input.workspaceId,
      identity.invocationId,
    ))
  } catch (error) {
    await releaseWebsiteReservation({
      workspaceId: input.workspaceId,
      invocationId: identity.invocationId,
      originalError: error,
    }, dependencies)
    throw error
  }

  const startedAt = dependencies.monotonicNow()
  let result: T
  try {
    result = await input.invoke()
  } catch (error) {
    await settleWebsiteUsageUnavailable({
      workspaceId: input.workspaceId,
      invocationId: identity.invocationId,
      maximumCostCnyMicros,
      startedAt,
      failed: true,
      failureKind: 'website_engine_failed',
      originalError: error,
    }, dependencies)
    throw error
  }

  let completion: WebsiteBillingCompletion
  try {
    completion = input.completion(result)
    validateWebsiteOutputHash(completion.outputHash)
  } catch (error) {
    await settleWebsiteUsageUnavailable({
      workspaceId: input.workspaceId,
      invocationId: identity.invocationId,
      maximumCostCnyMicros,
      startedAt,
      failed: true,
      failureKind: 'website_usage_invalid',
      originalError: error,
    }, dependencies)
    throw error
  }

  if (
    completion.durationSource !== 'output'
    || completion.durationSec === null
    || completion.durationSec <= 0
  ) {
    await settleWebsiteUsageUnavailable({
      workspaceId: input.workspaceId,
      invocationId: identity.invocationId,
      maximumCostCnyMicros,
      startedAt,
      failed: false,
    }, dependencies)
    return result
  }

  let billedSeconds: number
  let actualCostCnyMicros: bigint
  try {
    billedSeconds = wholeVideoSeconds(completion.durationSec)
    actualCostCnyMicros = dependencies.calculateActualCost(
      rateCard.prices,
      { kind: 'workflow', videoSeconds: completion.durationSec },
    )
  } catch (error) {
    await settleWebsiteUsageUnavailable({
      workspaceId: input.workspaceId,
      invocationId: identity.invocationId,
      maximumCostCnyMicros,
      startedAt,
      failed: true,
      failureKind: 'website_usage_invalid',
      originalError: error,
    }, dependencies)
    throw error
  }
  if (actualCostCnyMicros > maximumCostCnyMicros) {
    await settleWebsiteUsageUnavailable({
      workspaceId: input.workspaceId,
      invocationId: identity.invocationId,
      maximumCostCnyMicros,
      startedAt,
      failed: false,
    }, dependencies)
    return result
  }
  await dependencies.settleManagedInvocation({
    ...websiteBillingScope(input.workspaceId, identity.invocationId),
    actualCostCnyMicros,
    usageStatus: 'reported',
    invocationStatus: 'succeeded',
    usage: {
      schemaVersion: 2,
      capability: WEBSITE_CAPABILITY,
      kind: 'workflow',
      videoSeconds: billedSeconds,
    },
    outputHash: completion.outputHash,
    providerDurationMs: Math.max(
      0,
      Math.round(dependencies.monotonicNow() - startedAt),
    ),
  })
  return result
}

function reservation(
  input: Pick<
    ManagedWebsiteBillingInput<never>,
    'workspaceId' | 'attemptId' | 'invocationNo'
  >,
  identity: WebsiteBillingIdentity,
  rateCard: CurrentRateCard,
  maximumCostCnyMicros: bigint,
): ManagedInvocationReservation {
  return {
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    invocationId: identity.invocationId,
    idempotencyKey: identity.idempotencyKey,
    rateCardId: rateCard.id,
    maximumCostCnyMicros,
    create: {
      attemptId: input.attemptId,
      invocationNo: input.invocationNo,
      provider: WEBSITE_PROVIDER,
      model: WEBSITE_MODEL,
      capability: WEBSITE_CAPABILITY,
      operation: WEBSITE_OPERATION,
      source: 'products',
      inputHash: identity.inputHash,
    },
  }
}
