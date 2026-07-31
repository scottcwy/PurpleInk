import 'server-only'
import { createHash } from 'node:crypto'
import { billingInvocationNo } from '@/features/billing'
import { ManagedAiGateway, type ManagedAiHandle } from './managed-gateway'
import {
  resolveDirectorModelTarget,
  type DirectorModelTarget,
} from './model-routing'
import { PROVIDER_REGISTRY } from './provider-registry'
import { withProviderDispatch } from './provider-dispatch'
import {
  providerErrorFromResponse,
  providerNetworkError,
  ProviderRequestError,
  type ProviderFunding,
} from './provider-request-error'

export const VISION_QA_MAX_OUTPUT_TOKENS = 4_096

export interface ManagedVisionInput {
  attemptId: string
  invocationIndex: number
  prompt: string
  images: Array<{ label: string; bytes: Buffer }>
}

interface VisionCompletion {
  content: string | null
  usage: {
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
  } | null
}

type VisionMessage =
  | { role: 'system'; content: string }
  | {
      role: 'user'
      content: Array<
        | { type: 'text'; text: string }
        | {
            type: 'image_url'
            image_url: { url: string; detail: 'high' }
          }
      >
    }

export interface ManagedVisionExecutorDependencies {
  resolveTarget: () => Promise<DirectorModelTarget>
  gateway: Pick<ManagedAiGateway, 'prepare'>
  complete(input: {
    apiKey: string
    baseUrl: string
    model: string
    messages: VisionMessage[]
    maxOutputTokens: number
    providerId: DirectorModelTarget['provider']
    providerLabel: string
    funding: ProviderFunding
  }): Promise<VisionCompletion>
  dispatch: typeof withProviderDispatch
}

export async function executeManagedVisionQa(
  input: ManagedVisionInput,
  deps: Partial<ManagedVisionExecutorDependencies> = {},
): Promise<{ provider: DirectorModelTarget['provider']; model: string; content: string }> {
  const dependencies = { ...defaultDependencies(), ...deps }
  const target = await dependencies.resolveTarget()
  const messages = buildMessages(input)
  const prepared = await dependencies.gateway.prepare({
    attemptId: input.attemptId,
    invocationNo: billingInvocationNo('vision-qa', input.invocationIndex),
    provider: target.provider,
    model: target.modelId,
    capability: 'vision',
    rawInput: JSON.stringify(messages),
    maxOutputTokens: VISION_QA_MAX_OUTPUT_TOKENS,
    execution: {
      attemptGroupId: input.attemptId,
      logicalModelId: target.logicalModelId ?? target.modelId,
      outboundModelId: target.modelId,
      deploymentId: target.deploymentId,
      channelId: target.channelId,
      adapterProtocol: target.adapterProtocol,
      officialPriceIdentity: target.officialPriceIdentity,
      providerPoolId: target.providerPoolId,
      failureDomainId: target.failureDomainId,
    },
    ...(target.resolvedPlan ? { resolvedPlan: target.resolvedPlan } : {}),
  })
  const apiKey = prepared.credential ?? target.apiKey
  if (!apiKey) {
    throw new Error(
      `${PROVIDER_REGISTRY[target.provider].label} API Key 未配置，无法执行 Vision QA`,
    )
  }
  return dependencies.dispatch({
    providerId: target.provider,
    providerLabel: PROVIDER_REGISTRY[target.provider].label,
    funding: prepared.dispatchFunding,
    apiKey,
    ...(target.providerPoolId ? { poolId: target.providerPoolId } : {}),
    attemptId: input.attemptId,
  }, async () => {
  const handle = await prepared.begin()
  try {
    await handle.markProviderStarted?.()
    const providerLabel = PROVIDER_REGISTRY[target.provider].label
    const funding = target.funding ?? 'managed'
    const completion = await dependencies.complete({
      apiKey,
      baseUrl: target.baseUrl,
      model: target.modelId,
      messages,
      maxOutputTokens: VISION_QA_MAX_OUTPUT_TOKENS,
      providerId: target.provider,
      providerLabel,
      funding,
    })
    if (!completion.content) {
      await settleVision(handle, completion, true, messages)
      throw new Error('Vision 模型未返回报告')
    }
    await settleVision(handle, completion, false, messages)
    return {
      provider: target.provider,
      model: target.modelId,
      content: completion.content,
    }
  } catch (error) {
    if (error instanceof ProviderRequestError && isRejectedWithoutUsage(error)) {
      if (handle.settleRejected) await handle.settleRejected(error.kind)
      else await handle.releaseBeforeCall()
    } else {
      await handle.settleUnavailable(
        true,
        error instanceof ProviderRequestError ? error.kind : 'unknown',
      )
    }
    throw error
  }
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

function defaultDependencies(): ManagedVisionExecutorDependencies {
  return {
    resolveTarget: () => resolveDirectorModelTarget('shot-qa', 'vision'),
    gateway: new ManagedAiGateway(),
    dispatch: withProviderDispatch,
    complete: async (input) => {
      let response: Response
      try {
        response = await fetch(
          `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${input.apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: input.model,
              messages: input.messages,
              max_tokens: input.maxOutputTokens,
            }),
          },
        )
      } catch (cause) {
        throw providerNetworkError({
          providerId: input.providerId,
          providerLabel: input.providerLabel,
          operation: '视觉分析',
          funding: input.funding,
          cause,
        })
      }
      if (!response.ok) {
        throw providerErrorFromResponse({
          response,
          providerId: input.providerId,
          providerLabel: input.providerLabel,
          operation: '视觉分析',
          funding: input.funding,
        })
      }
      const completion: unknown = await response.json()
      const parsed = parseCompletion(completion)
      return {
        content: parsed.content,
        usage: parsed.usage,
      }
    },
  }
}

function buildMessages(
  input: ManagedVisionInput,
): VisionMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是严格的视频分镜验收器。只返回 JSON，不要 Markdown。每个合同项必须逐条且恰好出现一次。',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: input.prompt },
        ...input.images.map((image) => ({
          type: 'image_url' as const,
          image_url: {
            url: `data:image/png;base64,${image.bytes.toString('base64')}`,
            detail: 'high' as const,
          },
        })),
      ],
    },
  ]
}

function parseCompletion(value: unknown): VisionCompletion {
  if (!isRecord(value)) return { content: null, usage: null }
  const choices = Array.isArray(value.choices) ? value.choices : []
  const first = isRecord(choices[0]) ? choices[0] : null
  const message = first && isRecord(first.message) ? first.message : null
  const content = typeof message?.content === 'string' ? message.content : null
  return {
    content,
    usage: normalizeUsage(value.usage),
  }
}

function normalizeUsage(value: unknown): VisionCompletion['usage'] {
  if (!isRecord(value)) return null
  const promptTokens = usageInteger(value.prompt_tokens)
  const outputTokens = usageInteger(value.completion_tokens)
  if (promptTokens === null || outputTokens === null) return null
  const details = isRecord(value.prompt_tokens_details)
    ? value.prompt_tokens_details
    : null
  const cached = usageInteger(details?.cached_tokens) ?? 0
  return {
    inputTokens: Math.max(0, promptTokens - cached),
    cachedInputTokens: cached,
    outputTokens,
  }
}

function usageInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function settleVision(
  handle: ManagedAiHandle,
  completion: VisionCompletion,
  failed: boolean,
  messages: VisionMessage[],
): Promise<void> {
  if (!completion.usage) {
    if (failed || !completion.content) {
      await handle.settleUnavailable(failed)
      return
    }
    const outputHash = createHash('sha256').update(completion.content).digest('hex')
    await handle.settle({
      kind: 'text',
      inputTokens: Math.ceil(JSON.stringify(messages).length / 4),
      cachedInputTokens: 0,
      outputTokens: Math.ceil(completion.content.length / 4),
    }, outputHash, false, 'estimated')
    return
  }
  const outputHash = completion.content
    ? createHash('sha256').update(completion.content).digest('hex')
    : undefined
  await handle.settle({
    kind: 'text',
    ...completion.usage,
  }, outputHash, failed)
}
