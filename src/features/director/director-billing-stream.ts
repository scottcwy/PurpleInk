import 'server-only'
import { createHash } from 'node:crypto'
import {
  lazyStream,
} from '@earendil-works/pi-ai/api/lazy'
import type {
  Api,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import {
  ManagedAiGateway,
  type ManagedAiHandle,
} from '@/features/ai'
import type { ResolvedExecutionPlanV2 } from '@/features/ai/execution-plan'
import {
  reserveProviderDispatch,
  type ProviderDispatchLease,
} from '@/features/ai/provider-dispatch'
import {
  ProviderRequestError,
  type ProviderFailureKind,
} from '@/features/ai/provider-request-error'
import {
  estimatedTextUsage,
  estimatedTokens,
  reportedTextUsage,
} from './director-billing-usage'
import {
  billingInvocationNo,
  ProviderInvocationAlreadyStartedError,
  type BillingInvocationScope,
} from '@/features/billing'

interface DirectorBillingRuntime {
  providerId: Parameters<ManagedAiGateway['begin']>[0]['provider']
  modelId: string
  maxOutputTokens: number
  deductsManagedPool: boolean
  providerLabel: string
  funding: 'managed' | 'byok'
  apiKey: string
  providerPoolId?: string
  logicalModelId?: string
  deploymentId?: string
  channelId?: string
  adapterProtocol?: string
  officialPriceIdentity?: string
  failureDomainId?: string
  resolvedPlan?: ResolvedExecutionPlanV2
}

/** 单次上游调用的硬上限；队列层负责重试，SDK 内不得再做嵌套重试。 */
export const DIRECTOR_PROVIDER_TIMEOUT_MS = 4 * 60_000
const PROVIDER_SDK_TIMEOUT_GRACE_MS = 1_000

/** 模型出网前的内部审计/计费上下文不完整；不得计入 Provider 熔断。 */
export class DirectorPreflightError extends Error {
  override readonly name = 'DirectorPreflightError'
}

export function createDirectorBillingStream(input: {
  model: Model<Api>
  context: Context
  options?: SimpleStreamOptions
  runtime: DirectorBillingRuntime
  attemptId?: string
  invocationIndex: number
  billingScope?: BillingInvocationScope
  capability?: 'text' | 'vision'
  operationId?: string
  operation?: string
  source?: string
  gateway: ManagedAiGateway
  /** 出网前的审计、配额或路由前置失败；调用方据此保留原始类型，不得误计 Provider 熔断。 */
  onPreflightFailure?: (error: unknown) => void
  /** 出网后的类型化 Provider 失败；pi 会把流异常降格成 error event，调用方须保留原始类型。 */
  onProviderFailure?: (error: ProviderRequestError) => void
  streamSimple: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream
}): AssistantMessageEventStream {
  return lazyStream(input.model, async () => billedEvents(input))
}

async function* billedEvents(
  input: Parameters<typeof createDirectorBillingStream>[0],
): AsyncGenerator<AssistantMessageEvent> {
  let handle: ManagedAiHandle
  let dispatch: ProviderDispatchLease | null = null
  let dispatchOutcome: 'success' | ProviderFailureKind = 'unknown'
  try {
    dispatch = await reserveProviderDispatch({
      providerId: input.runtime.providerId,
      providerLabel: input.runtime.providerLabel,
      funding: input.runtime.funding,
      apiKey: input.runtime.apiKey,
      attemptId: input.attemptId,
      tokenEstimate: estimatedTokens(input),
      ...(input.runtime.providerPoolId
        ? { poolId: input.runtime.providerPoolId }
        : {}),
    })
    handle = await beginInvocation(input)
  } catch (error) {
    await dispatch?.release('unknown')
    input.onPreflightFailure?.(error)
    throw error
  }
  let providerStarted = false
  let settled = false
  try {
    await handle.markProviderStarted?.()
    providerStarted = true
    const deadlineMs = providerDeadlineMs(input.options)
    const deadlineController = new AbortController()
    const options = providerOptions(
      input.options,
      deadlineMs,
      deadlineController.signal,
    )
    const upstream = input.streamSimple(
      input.model,
      input.context,
      options,
    )
    for await (const event of eventsBeforeDeadline(
      upstream,
      deadlineMs,
      input.runtime,
      deadlineController,
    )) {
      if (event.type === 'done' || event.type === 'error') {
        await settleTerminal(handle, event, input)
        settled = true
        dispatchOutcome = event.type === 'done' ? 'success' : 'unknown'
      }
      yield event
    }
  } catch (error) {
    dispatchOutcome = error instanceof ProviderRequestError ? error.kind : 'unknown'
    if (error instanceof ProviderRequestError) {
      input.onProviderFailure?.(error)
      if (error.kind === 'rate_limit') {
        await dispatch?.defer(error.retryAt ? new Date(error.retryAt) : undefined)
      }
    }
    if (
      handle
      && !settled
      && !(error instanceof ProviderInvocationAlreadyStartedError)
    ) {
      if (providerStarted) {
        await handle.settleUnavailable(true, safeFailureKind(error))
      }
      else await handle.releaseBeforeCall()
    }
    throw error
  } finally {
    await dispatch?.release(dispatchOutcome)
  }
}

async function* eventsBeforeDeadline(
  upstream: AssistantMessageEventStream,
  timeoutMs: number,
  runtime: DirectorBillingRuntime,
  deadlineController: AbortController,
): AsyncGenerator<AssistantMessageEvent> {
  const iterator = upstream[Symbol.asyncIterator]()
  const deadline = Date.now() + timeoutMs
  try {
    while (true) {
      const next = await nextBeforeDeadline(
        iterator,
        Math.max(0, deadline - Date.now()),
        runtime,
        deadlineController,
      )
      if (next.done) return
      yield next.value
    }
  } finally {
    try {
      const returned = iterator.return?.()
      if (returned) void Promise.resolve(returned).catch(() => undefined)
    } catch {
      // The provider deadline remains the authoritative terminal result.
    }
  }
}

async function nextBeforeDeadline(
  iterator: AsyncIterator<AssistantMessageEvent>,
  remainingMs: number,
  runtime: DirectorBillingRuntime,
  deadlineController: AbortController,
): Promise<IteratorResult<AssistantMessageEvent>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const failure = new ProviderRequestError({
        providerId: runtime.providerId,
        providerLabel: runtime.providerLabel,
        operation: 'Director',
        funding: runtime.funding,
        kind: 'timeout',
      })
      reject(failure)
      deadlineController.abort(failure)
    }, remainingMs)
  })
  try {
    return await Promise.race([iterator.next(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

function providerOptions(
  options: SimpleStreamOptions | undefined,
  deadlineMs: number,
  deadlineSignal: AbortSignal,
): SimpleStreamOptions {
  const signal = options?.signal
    ? AbortSignal.any([options.signal, deadlineSignal])
    : deadlineSignal
  return {
    ...options,
    signal,
    // SDK 自身会把非 HTTP 超时压成 generic error event；让可信墙钟闸门先
    // 收敛并中止 SDK，才能稳定保留 PROVIDER_TIMEOUT 类型。
    timeoutMs: deadlineMs + PROVIDER_SDK_TIMEOUT_GRACE_MS,
    maxRetries: 0,
  }
}

function providerDeadlineMs(
  options: SimpleStreamOptions | undefined,
): number {
  return Math.min(
    options?.timeoutMs ?? DIRECTOR_PROVIDER_TIMEOUT_MS,
    DIRECTOR_PROVIDER_TIMEOUT_MS,
  )
}

async function beginInvocation(
  input: Parameters<typeof createDirectorBillingStream>[0],
): Promise<ManagedAiHandle> {
  if (!input.attemptId) {
    throw new DirectorPreflightError('Director 调用缺少可审计的 attemptId')
  }
  return input.gateway.begin({
    attemptId: input.attemptId,
    invocationNo: billingInvocationNo(
      input.billingScope ?? 'director',
      input.invocationIndex,
    ),
    provider: input.runtime.providerId,
    model: input.runtime.modelId,
    capability: input.capability ?? 'text',
    rawInput: JSON.stringify({
      systemPrompt: input.context.systemPrompt,
      messages: input.context.messages,
      tools: input.context.tools ?? [],
    }),
    ...(input.operation ? { operation: input.operation } : {}),
    ...(input.source ? { source: input.source } : {}),
    maxOutputTokens:
      input.options?.maxTokens ?? input.runtime.maxOutputTokens,
    execution: {
      ...(input.operationId ? { operationId: input.operationId } : {}),
      attemptGroupId: input.attemptId,
      logicalModelId: input.runtime.logicalModelId ?? input.runtime.modelId,
      outboundModelId: input.runtime.modelId,
      deploymentId: input.runtime.deploymentId,
      channelId: input.runtime.channelId,
      adapterProtocol: input.runtime.adapterProtocol,
      officialPriceIdentity: input.runtime.officialPriceIdentity,
      providerPoolId: input.runtime.providerPoolId,
      failureDomainId: input.runtime.failureDomainId,
    },
    ...(input.runtime.resolvedPlan
      ? { resolvedPlan: input.runtime.resolvedPlan }
      : {}),
  })
}

async function settleTerminal(
  handle: ManagedAiHandle,
  event: Extract<AssistantMessageEvent, { type: 'done' | 'error' }>,
  input: Parameters<typeof createDirectorBillingStream>[0],
): Promise<void> {
  const message = event.type === 'done' ? event.message : event.error
  const usage = reportedTextUsage(message)
  const outputHash = createHash('sha256')
    .update(JSON.stringify(message))
    .digest('hex')
  if (usage) {
    await handle.settle(usage, outputHash, event.type === 'error')
    return
  }
  if (event.type === 'done') {
    await handle.settle(
      estimatedTextUsage(input, message),
      outputHash,
      false,
      'estimated',
    )
    return
  }
  await handle.settleUnavailable(true)
}

function safeFailureKind(error: unknown): string {
  return error instanceof ProviderRequestError ? error.kind : 'unknown'
}
