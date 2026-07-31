import { describe, expect, it, vi } from 'vitest'
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
} from '@earendil-works/pi-ai'
import type { ManagedAiGateway, ManagedAiHandle } from '@/features/ai'
import {
  createDirectorBillingStream,
  DIRECTOR_PROVIDER_TIMEOUT_MS,
} from './director-billing-stream'

const { reserveProviderDispatch } = vi.hoisted(() => ({
  reserveProviderDispatch: vi.fn(async () => ({
    id: 'dispatch-1',
    scopeKey: 'a'.repeat(64),
    release: vi.fn(async () => undefined),
  })),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/features/ai/provider-dispatch', () => ({
  reserveProviderDispatch,
}))

const model = {
  id: 'step-3.5-flash',
  name: 'step-3.5-flash',
  api: 'openai-completions',
  provider: 'stepfun',
  baseUrl: 'https://example.invalid/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4_096,
} as Model<Api>

const context: Context = {
  systemPrompt: 'system',
  messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
  tools: [],
}

const message: AssistantMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  api: 'openai-completions',
  provider: 'stepfun',
  model: 'step-3.5-flash',
  usage: {
    input: 12,
    output: 3,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: 18,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: 2,
}

function upstream() {
  const stream = createAssistantMessageEventStream()
  stream.push({ type: 'done', reason: 'stop', message })
  return stream
}

function handle(order: string[]): ManagedAiHandle {
  return {
    invocationId: 'invocation',
    funding: 'managed',
    deductsManagedPool: true,
    credential: 'secret',
    settle: vi.fn(async () => {
      order.push('settled')
    }),
    settleUnavailable: vi.fn(async () => {
      order.push('settled-unavailable')
    }),
    releaseBeforeCall: vi.fn(async () => {
      order.push('released')
    }),
  }
}

async function consume(stream: ReturnType<typeof createDirectorBillingStream>) {
  const events = []
  for await (const event of stream) events.push(event)
  return events
}

describe('Director per-provider-call billing stream', () => {
  it('reserves and settles every tool-loop provider call independently', async () => {
    const order: string[] = []
    const billingHandle = handle(order)
    const begin = vi.fn(async (
      _input: Parameters<ManagedAiGateway['begin']>[0],
    ) => billingHandle)
    const streamSimple = vi.fn(upstream)
    const gateway = { begin } as unknown as ManagedAiGateway

    for (let index = 1; index <= 3; index += 1) {
      const events = await consume(createDirectorBillingStream({
        model,
        context,
        runtime: {
          providerId: 'stepfun',
          providerLabel: '阶跃星辰',
          funding: 'managed',
          apiKey: 'test-key',
          providerPoolId: 'stepfun.step-plan',
          modelId: model.id,
          maxOutputTokens: 4_096,
          deductsManagedPool: true,
        },
        attemptId: '00000000-0000-4000-8000-000000000001',
        invocationIndex: index,
        gateway,
        streamSimple,
      }))
      order.push(events.at(-1)?.type ?? 'missing')
    }

    expect(begin.mock.calls.map(([input]) => input.invocationNo)).toEqual([1, 2, 3])
    expect(streamSimple).toHaveBeenCalledTimes(3)
    expect(streamSimple).toHaveBeenCalledWith(
      model,
      context,
      expect.objectContaining({
        timeoutMs: DIRECTOR_PROVIDER_TIMEOUT_MS + 1_000,
        maxRetries: 0,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(reserveProviderDispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ poolId: 'stepfun.step-plan' }),
    )
    expect(order).toEqual([
      'settled', 'done',
      'settled', 'done',
      'settled', 'done',
    ])
  })

  it('preserves caller options while capping provider timeout and disabling nested retries', async () => {
    const streamSimple = vi.fn(upstream)
    const begin = vi.fn<ManagedAiGateway['begin']>()
      .mockResolvedValue(handle([]))
    await consume(createDirectorBillingStream({
      model,
      context,
      options: {
        maxTokens: 512,
        timeoutMs: DIRECTOR_PROVIDER_TIMEOUT_MS * 2,
        maxRetries: 3,
      },
      runtime: {
        providerId: 'stepfun',
        providerLabel: '阶跃星辰',
        funding: 'byok',
        apiKey: 'test-key',
        modelId: model.id,
        maxOutputTokens: 4_096,
        deductsManagedPool: false,
      },
      invocationIndex: 1,
      attemptId: '00000000-0000-4000-8000-000000000777',
      gateway: { begin } as unknown as ManagedAiGateway,
      streamSimple,
    }))

    expect(streamSimple).toHaveBeenCalledWith(model, context, expect.objectContaining({
      maxTokens: 512,
      timeoutMs: DIRECTOR_PROVIDER_TIMEOUT_MS + 1_000,
      maxRetries: 0,
      signal: expect.any(AbortSignal),
    }))
    expect(begin).toHaveBeenCalledOnce()
  })

  it('enforces the provider deadline when the SDK stream never settles', async () => {
    const order: string[] = []
    const billingHandle = handle(order)
    let providerSignal: AbortSignal | undefined
    let providerTimeoutMs: number | undefined
    const streamSimple = vi.fn((
      _model: Model<Api>,
      _context: Context,
      options?: { signal?: AbortSignal; timeoutMs?: number },
    ) => {
      providerSignal = options?.signal
      providerTimeoutMs = options?.timeoutMs
      return createAssistantMessageEventStream()
    })
    const onProviderFailure = vi.fn()
    const events = await consume(createDirectorBillingStream({
      model,
      context,
      options: { timeoutMs: 15 },
      runtime: {
        providerId: 'stepfun',
        providerLabel: '阶跃星辰',
        funding: 'managed',
        apiKey: 'test-key',
        modelId: model.id,
        maxOutputTokens: 4_096,
        deductsManagedPool: true,
      },
      invocationIndex: 1,
      attemptId: '00000000-0000-4000-8000-000000000001',
      gateway: {
        begin: vi.fn(async () => billingHandle),
      } as unknown as ManagedAiGateway,
      onProviderFailure,
      streamSimple,
    }))

    expect(events.at(-1)?.type).toBe('error')
    expect(billingHandle.settleUnavailable).toHaveBeenCalledWith(true, 'timeout')
    expect(providerTimeoutMs).toBeGreaterThan(15)
    expect(providerSignal?.aborted).toBe(true)
    expect(providerSignal?.reason).toMatchObject({
      name: 'ProviderRequestError',
      kind: 'timeout',
    })
    expect(onProviderFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ProviderRequestError',
        kind: 'timeout',
      }),
    )
  })

  it('does not start the next provider call when reservation is rejected', async () => {
    const billingHandle = handle([])
    const begin = vi.fn<ManagedAiGateway['begin']>()
      .mockResolvedValueOnce(billingHandle)
      .mockRejectedValueOnce(new Error('quota_exhausted'))
    const streamSimple = vi.fn(upstream)
    const gateway = { begin } as unknown as ManagedAiGateway
    const base = {
      model,
      context,
      runtime: {
        providerId: 'stepfun' as const,
        providerLabel: '阶跃星辰',
        funding: 'managed' as const,
        apiKey: 'test-key',
        modelId: model.id,
        maxOutputTokens: 4_096,
        deductsManagedPool: true,
      },
      attemptId: '00000000-0000-4000-8000-000000000001',
      gateway,
      streamSimple,
    }

    await consume(createDirectorBillingStream({ ...base, invocationIndex: 1 }))
    const blocked = await consume(
      createDirectorBillingStream({ ...base, invocationIndex: 2 }),
    )

    expect(blocked.at(-1)?.type).toBe('error')
    expect(streamSimple).toHaveBeenCalledTimes(1)
  })

  it('reports a preflight failure before any provider call starts', async () => {
    const preflightFailure = new Error('托管 Director 调用缺少可审计的 attemptId')
    const begin = vi.fn<ManagedAiGateway['begin']>()
      .mockRejectedValueOnce(preflightFailure)
    const streamSimple = vi.fn(upstream)
    const onPreflightFailure = vi.fn()

    const events = await consume(createDirectorBillingStream({
      model,
      context,
      runtime: {
        providerId: 'stepfun',
        providerLabel: '阶跃星辰',
        funding: 'managed',
        apiKey: 'test-key',
        modelId: model.id,
        maxOutputTokens: 4_096,
        deductsManagedPool: true,
      },
      attemptId: '00000000-0000-4000-8000-000000000001',
      invocationIndex: 1,
      gateway: { begin } as unknown as ManagedAiGateway,
      onPreflightFailure,
      streamSimple,
    }))

    expect(events.at(-1)?.type).toBe('error')
    expect(onPreflightFailure).toHaveBeenCalledWith(preflightFailure)
    expect(streamSimple).not.toHaveBeenCalled()
  })

  it('settles a provider error with reported usage before forwarding it', async () => {
    const order: string[] = []
    const billingHandle = handle(order)
    const begin = vi.fn(async (
      _input: Parameters<ManagedAiGateway['begin']>[0],
    ) => billingHandle)
    const streamSimple = vi.fn(() => {
      const stream = createAssistantMessageEventStream()
      stream.push({
        type: 'error',
        reason: 'error',
        error: { ...message, stopReason: 'error', errorMessage: 'upstream' },
      })
      return stream
    })
    const events = await consume(createDirectorBillingStream({
      model,
      context,
      runtime: {
        providerId: 'stepfun',
        providerLabel: '阶跃星辰',
        funding: 'managed',
        apiKey: 'test-key',
        modelId: model.id,
        maxOutputTokens: 4_096,
        deductsManagedPool: true,
      },
      attemptId: '00000000-0000-4000-8000-000000000001',
      invocationIndex: 1,
      gateway: { begin } as unknown as ManagedAiGateway,
      streamSimple,
    }))
    order.push(events.at(-1)?.type ?? 'missing')

    expect(billingHandle.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        inputTokens: 12,
        outputTokens: 3,
      }),
      expect.stringMatching(/^[0-9a-f]{64}$/),
      true,
    )
    expect(order).toEqual(['settled', 'error'])
  })

  it('does not forward a successful terminal event when settlement fails', async () => {
    const billingHandle = handle([])
    vi.mocked(billingHandle.settle).mockRejectedValueOnce(
      new Error('settlement failed'),
    )
    const begin = vi.fn(async (
      _input: Parameters<ManagedAiGateway['begin']>[0],
    ) => billingHandle)
    const events = await consume(createDirectorBillingStream({
      model,
      context,
      runtime: {
        providerId: 'stepfun',
        providerLabel: '阶跃星辰',
        funding: 'managed',
        apiKey: 'test-key',
        modelId: model.id,
        maxOutputTokens: 4_096,
        deductsManagedPool: true,
      },
      attemptId: '00000000-0000-4000-8000-000000000001',
      invocationIndex: 1,
      gateway: { begin } as unknown as ManagedAiGateway,
      streamSimple: vi.fn(upstream),
    }))

    expect(events.map((event) => event.type)).toEqual(['error'])
  })
})
