import { describe, expect, it, vi } from 'vitest'
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
} from '@earendil-works/pi-ai'
import type { ManagedAiGateway, ManagedAiHandle } from '@/features/ai'
import type { ResolvedExecutionPlanV2 } from '@/features/ai/execution-plan'
import { createDirectorModelStream } from './director-gemini-fallback-stream'
import type { DirectorModelRuntime } from './pi-provider'

vi.mock('server-only', () => ({}))
vi.mock('@/features/ai/provider-dispatch', () => ({
  reserveProviderDispatch: vi.fn(async () => ({
    id: 'dispatch',
    scopeKey: 'a'.repeat(64),
    release: vi.fn(async () => undefined),
  })),
}))

const primaryModel = model('gemini-3.6-flash-tiered')
const fallbackModel = model('gemini-3.1-flash-lite')

describe('Director Gemini same-channel fallback', () => {
  it('records a separate invocation and suppresses the primary terminal error', async () => {
    const begin = vi.fn(async (
      _input: Parameters<ManagedAiGateway['begin']>[0],
    ) => handle())
    const streamSimple = vi.fn((nextModel: Model<Api>) => {
      const stream = createAssistantMessageEventStream()
      if (nextModel.id === primaryModel.id) {
        stream.push({
          type: 'error',
          reason: 'error',
          error: { ...message(primaryModel.id), stopReason: 'error' },
        })
      } else {
        stream.push({
          type: 'done',
          reason: 'stop',
          message: message(fallbackModel.id),
        })
      }
      return stream
    })
    let invocationIndex = 0
    const fallbackStarted = vi.fn()
    const events = []
    for await (const event of createDirectorModelStream({
      model: primaryModel,
      context: {
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
        tools: [],
      },
      runtime: runtime(),
      attemptId: '00000000-0000-4000-8000-000000000001',
      nextInvocationIndex: () => ++invocationIndex,
      billingScope: 'worker-text',
      capability: 'vision',
      operationId: 'website:job:compose:1',
      operation: 'website-compose',
      source: 'worker',
      gateway: { begin } as unknown as ManagedAiGateway,
      getObservedHttpStatus: () => 429,
      onFallbackStarted: fallbackStarted,
      onPreflightFailure: vi.fn(),
      onProviderFailure: vi.fn(),
      streamSimple,
    })) {
      events.push(event)
    }

    expect(begin.mock.calls.map(([input]) => input.invocationNo))
      .toEqual([50_000, 50_001])
    expect(begin.mock.calls.map(([input]) => input.capability))
      .toEqual(['vision', 'vision'])
    expect(begin.mock.calls.map(([input]) => input.execution?.operationId))
      .toEqual(['website:job:compose:1', 'website:job:compose:1'])
    expect(begin.mock.calls.map(([input]) => input.resolvedPlan?.outboundModelId))
      .toEqual([primaryModel.id, fallbackModel.id])
    expect(streamSimple.mock.calls.map(([nextModel]) => nextModel.id))
      .toEqual([primaryModel.id, fallbackModel.id])
    expect(events.map((event) => event.type)).toEqual(['done'])
    expect(fallbackStarted).toHaveBeenCalledOnce()
  })
})

function runtime(): DirectorModelRuntime {
  return {
    models: {} as DirectorModelRuntime['models'],
    model: primaryModel,
    apiKey: 'managed-gemini-key',
    providerId: 'gemini',
    providerLabel: 'Google Gemini',
    funding: 'managed',
    routeLabel: 'gemini/gemini-3.6-flash-tiered',
    modelId: primaryModel.id,
    maxOutputTokens: 4_096,
    deductsManagedPool: true,
    providerPoolId: 'gemini.bcai',
    fallbackDeploymentId: 'gemini.3.1-flash-lite.managed',
    fallbackModel,
    fallbackModelId: fallbackModel.id,
    resolvedPlan: executionPlan(),
  }
}

function executionPlan(): ResolvedExecutionPlanV2 {
  const route = (input: {
    modelId: string
    deploymentId: string
  }): ResolvedExecutionPlanV2 => ({
    schemaVersion: 2,
    kind: 'built-in',
    providerId: 'gemini',
    fundingSource: 'managed',
    logicalModelId: input.modelId,
    outboundModelId: input.modelId,
    deploymentId: input.deploymentId,
    channelId: 'gemini.bcai',
    adapterProtocol: 'openai-completions',
    baseUrl: 'https://bcai.online/v1',
    officialPriceIdentity: `google.${input.modelId}`,
    providerPoolId: 'gemini.bcai',
    failureDomainId: 'gemini.bcai',
    capability: 'vision',
    catalogId: `catalog-${input.modelId}`,
    planVersion: '2026-08-01.1',
    credentialLease: {
      source: 'managed',
      reference: 'CVC_MANAGED_GEMINI_API_KEY',
      version: '2026-08-01.1',
      credential: 'managed-gemini-key',
    },
  })
  const fallback = route({
    modelId: fallbackModel.id,
    deploymentId: 'gemini.3.1-flash-lite.managed',
  })
  return {
    ...route({
      modelId: primaryModel.id,
      deploymentId: 'gemini.3.6-flash-tiered.managed',
    }),
    fallback,
  }
}

function model(id: string): Model<Api> {
  return {
    id,
    name: id,
    api: 'openai-completions',
    provider: 'gemini',
    baseUrl: 'https://bcai.online/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  }
}

function message(modelId: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    api: 'openai-completions',
    provider: 'gemini',
    model: modelId,
    usage: {
      input: 10,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 12,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 2,
  }
}

function handle(): ManagedAiHandle {
  return {
    invocationId: crypto.randomUUID(),
    funding: 'managed',
    deductsManagedPool: true,
    credential: 'managed-gemini-key',
    markProviderStarted: vi.fn(async () => undefined),
    settle: vi.fn(async () => undefined),
    settleUnavailable: vi.fn(async () => undefined),
    releaseBeforeCall: vi.fn(async () => undefined),
  }
}
