import 'server-only'
import { createHash } from 'node:crypto'
import {
  lazyStream,
} from '@earendil-works/pi-ai/api/lazy'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import {
  ManagedAiGateway,
  type ManagedAiHandle,
  type ManagedUsage,
} from '@/features/ai'
import {
  reserveProviderDispatch,
  type ProviderDispatchLease,
} from '@/features/ai/provider-dispatch'
import { ProviderRequestError } from '@/features/ai/provider-request-error'
import { billingInvocationNo } from '@/features/billing'

interface DirectorBillingRuntime {
  providerId: Parameters<ManagedAiGateway['begin']>[0]['provider']
  modelId: string
  maxOutputTokens: number
  deductsManagedPool: boolean
  providerLabel: string
  funding: 'managed' | 'byok'
  apiKey: string
}

/** 单次上游调用的硬上限；队列层负责重试，SDK 内不得再做嵌套重试。 */
export const DIRECTOR_PROVIDER_TIMEOUT_MS = 4 * 60_000

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
  gateway: ManagedAiGateway
  /** 出网前的审计、配额或路由前置失败；调用方据此保留原始类型，不得误计 Provider 熔断。 */
  onPreflightFailure?: (error: unknown) => void
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
  try {
    dispatch = await reserveProviderDispatch({
      providerId: input.runtime.providerId,
      providerLabel: input.runtime.providerLabel,
      funding: input.runtime.funding,
      apiKey: input.runtime.apiKey,
      attemptId: input.attemptId,
      tokenEstimate: estimatedTokens(input),
    })
    handle = await beginInvocation(input)
  } catch (error) {
    await dispatch?.release()
    input.onPreflightFailure?.(error)
    throw error
  }
  let providerStarted = false
  let settled = false
  try {
    await handle.markProviderStarted?.()
    providerStarted = true
    const upstream = input.streamSimple(
      input.model,
      input.context,
      providerOptions(input.options),
    )
    for await (const event of upstream) {
      if (event.type === 'done' || event.type === 'error') {
        await settleTerminal(handle, event)
        settled = true
      }
      yield event
    }
  } catch (error) {
    if (error instanceof ProviderRequestError && error.kind === 'rate_limit') {
      await dispatch?.defer(error.retryAt ? new Date(error.retryAt) : undefined)
    }
    if (handle && !settled) {
      if (providerStarted) {
        await handle.settleUnavailable(true, safeFailureKind(error))
      }
      else await handle.releaseBeforeCall()
    }
    throw error
  } finally {
    await dispatch?.release()
  }
}

function providerOptions(
  options: SimpleStreamOptions | undefined,
): SimpleStreamOptions {
  return {
    ...options,
    timeoutMs: Math.min(
      options?.timeoutMs ?? DIRECTOR_PROVIDER_TIMEOUT_MS,
      DIRECTOR_PROVIDER_TIMEOUT_MS,
    ),
    maxRetries: 0,
  }
}

async function beginInvocation(
  input: Parameters<typeof createDirectorBillingStream>[0],
): Promise<ManagedAiHandle> {
  if (!input.attemptId) {
    throw new DirectorPreflightError('Director 调用缺少可审计的 attemptId')
  }
  return input.gateway.begin({
    attemptId: input.attemptId,
    invocationNo: billingInvocationNo('director', input.invocationIndex),
    provider: input.runtime.providerId,
    model: input.runtime.modelId,
    capability: 'text',
    rawInput: JSON.stringify({
      systemPrompt: input.context.systemPrompt,
      messages: input.context.messages,
      tools: input.context.tools ?? [],
    }),
    maxOutputTokens:
      input.options?.maxTokens ?? input.runtime.maxOutputTokens,
  })
}

async function settleTerminal(
  handle: ManagedAiHandle,
  event: Extract<AssistantMessageEvent, { type: 'done' | 'error' }>,
): Promise<void> {
  const message = event.type === 'done' ? event.message : event.error
  const usage = reportedTextUsage(message)
  if (!usage) {
    await handle.settleUnavailable(event.type === 'error')
    return
  }
  const outputHash = createHash('sha256')
    .update(JSON.stringify(message))
    .digest('hex')
  await handle.settle(usage, outputHash, event.type === 'error')
}

function safeFailureKind(error: unknown): string {
  return error instanceof ProviderRequestError ? error.kind : 'unknown'
}

function reportedTextUsage(message: AssistantMessage): ManagedUsage | null {
  const usage = message.usage
  const values = [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
  ]
  if (!values.every(isUsageNumber)) return null
  if (values.every((value) => value === 0)) return null
  return {
    kind: 'text',
    inputTokens: usage.input,
    cachedInputTokens: usage.cacheRead + usage.cacheWrite,
    outputTokens: usage.output,
  }
}

function isUsageNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function estimatedTokens(
  input: Parameters<typeof createDirectorBillingStream>[0]
): number {
  const inputCharacters = JSON.stringify({
    systemPrompt: input.context.systemPrompt,
    messages: input.context.messages,
    tools: input.context.tools ?? [],
  }).length
  return Math.ceil(inputCharacters / 4)
    + (input.options?.maxTokens ?? input.runtime.maxOutputTokens)
}
