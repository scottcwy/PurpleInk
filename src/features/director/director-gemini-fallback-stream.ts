import 'server-only'
import { lazyStream } from '@earendil-works/pi-ai/api/lazy'
import type {
  Api,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import type { ManagedAiGateway } from '@/features/ai'
import {
  shouldUseGeminiModelFallback,
  type GeminiFallbackFailureKind,
} from '@/features/ai/execution-plan'
import {
  ProviderRequestError,
  providerFailureKind,
  type ProviderFailureKind,
} from '@/features/ai/provider-request-error'
import {
  createDirectorBillingStream,
} from './director-billing-stream'
import type { DirectorModelRuntime } from './pi-provider'

interface FallbackStreamInput {
  model: Model<Api>
  context: Context
  options?: SimpleStreamOptions
  runtime: DirectorModelRuntime
  attemptId?: string
  nextInvocationIndex: () => number
  gateway: ManagedAiGateway
  getObservedHttpStatus: () => number | undefined
  onFallbackStarted: () => void
  onPreflightFailure: (error: unknown) => void
  onProviderFailure: (error: ProviderRequestError) => void
  streamSimple: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream
}

export function createDirectorModelStream(
  input: FallbackStreamInput,
): AssistantMessageEventStream {
  return lazyStream(input.model, async () => eventsWithFallback(input))
}

async function* eventsWithFallback(
  input: FallbackStreamInput,
): AsyncGenerator<AssistantMessageEvent> {
  let capturedFailure: ProviderRequestError | undefined
  try {
    for await (const event of attemptEvents(
      input,
      input.model,
      input.runtime,
      (error) => { capturedFailure = error },
    )) {
      if (event.type !== 'error') {
        yield event
        continue
      }
      const kind = fallbackKind(
        capturedFailure?.kind
          ?? providerFailureKind(input.getObservedHttpStatus()),
      )
      if (!canFallback(input.runtime, kind)) {
        yield event
        return
      }
      yield* fallbackEvents(input)
      return
    }
  } catch (error) {
    const kind = fallbackKind(
      error instanceof ProviderRequestError ? error.kind : 'unknown',
    )
    if (!canFallback(input.runtime, kind)) throw error
    yield* fallbackEvents(input)
  }
}

async function* fallbackEvents(
  input: FallbackStreamInput,
): AsyncGenerator<AssistantMessageEvent> {
  const fallbackModel = input.runtime.fallbackModel
  if (!fallbackModel) return
  input.onFallbackStarted()
  const fallbackRuntime: DirectorModelRuntime = {
    ...input.runtime,
    model: fallbackModel,
    modelId: fallbackModel.id,
    logicalModelId: input.runtime.fallback?.logicalModelId ?? fallbackModel.id,
    deploymentId: input.runtime.fallback?.deploymentId,
    officialPriceIdentity: input.runtime.fallback?.officialPriceIdentity,
    routeLabel: `${input.runtime.providerId}/${fallbackModel.id}（同渠道回退）`,
    fallbackModel: undefined,
    fallbackModelId: undefined,
    fallbackDeploymentId: undefined,
    fallback: undefined,
  }
  yield* attemptEvents(
    input,
    fallbackModel,
    fallbackRuntime,
    input.onProviderFailure,
  )
}

function attemptEvents(
  input: FallbackStreamInput,
  model: Model<Api>,
  runtime: DirectorModelRuntime,
  onProviderFailure: (error: ProviderRequestError) => void,
): AssistantMessageEventStream {
  return createDirectorBillingStream({
    model,
    context: input.context,
    options: input.options,
    runtime,
    attemptId: input.attemptId,
    invocationIndex: input.nextInvocationIndex(),
    gateway: input.gateway,
    onPreflightFailure: input.onPreflightFailure,
    onProviderFailure,
    streamSimple: input.streamSimple,
  })
}

function canFallback(
  runtime: DirectorModelRuntime,
  failureKind: GeminiFallbackFailureKind,
): boolean {
  if (runtime.providerId !== 'gemini') return false
  return shouldUseGeminiModelFallback({
    providerId: runtime.providerId,
    fundingSource: runtime.funding,
    fallbackDeploymentId: runtime.fallbackDeploymentId,
  }, failureKind)
}

function fallbackKind(kind: ProviderFailureKind): GeminiFallbackFailureKind {
  if (kind === 'unavailable') return 'upstream_unavailable'
  if (kind === 'rate_limit' || kind === 'network' || kind === 'timeout') {
    return kind
  }
  if (kind === 'auth') return 'authentication'
  if (kind === 'request') return 'input_contract'
  if (kind === 'safety') return 'content'
  if (kind === 'balance') return 'quota'
  return 'unknown'
}
