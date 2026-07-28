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
import { billingInvocationNo } from '@/features/billing'

interface DirectorBillingRuntime {
  providerId: Parameters<ManagedAiGateway['begin']>[0]['provider']
  modelId: string
  maxOutputTokens: number
  deductsManagedPool: boolean
}

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
  let handle: ManagedAiHandle | null
  try {
    handle = await beginInvocation(input)
  } catch (error) {
    input.onPreflightFailure?.(error)
    throw error
  }
  let providerStarted = false
  let settled = false
  try {
    const upstream = input.streamSimple(input.model, input.context, input.options)
    providerStarted = true
    for await (const event of upstream) {
      if (event.type === 'done' || event.type === 'error') {
        await settleTerminal(handle, event)
        settled = true
      }
      yield event
    }
  } catch (error) {
    if (handle && !settled) {
      if (providerStarted) await handle.settleUnavailable(true)
      else await handle.releaseBeforeCall()
    }
    throw error
  }
}

async function beginInvocation(
  input: Parameters<typeof createDirectorBillingStream>[0],
): Promise<ManagedAiHandle | null> {
  if (!input.runtime.deductsManagedPool) return null
  if (!input.attemptId) {
    throw new DirectorPreflightError('托管 Director 调用缺少可审计的 attemptId')
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
  handle: ManagedAiHandle | null,
  event: Extract<AssistantMessageEvent, { type: 'done' | 'error' }>,
): Promise<void> {
  if (!handle) return
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
