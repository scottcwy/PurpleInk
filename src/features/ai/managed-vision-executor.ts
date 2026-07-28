import 'server-only'
import { createHash } from 'node:crypto'
import { billingInvocationNo } from '@/features/billing'
import { ManagedAiGateway, type ManagedAiHandle } from './managed-gateway'
import {
  resolveDirectorModelTarget,
  type DirectorModelTarget,
} from './model-routing'
import { PROVIDER_REGISTRY } from './provider-registry'
import { managedUpstreamError } from './managed-service'

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
  gateway: Pick<ManagedAiGateway, 'begin'>
  complete(input: {
    apiKey: string
    baseUrl: string
    model: string
    messages: VisionMessage[]
    maxOutputTokens: number
  }): Promise<VisionCompletion>
}

export async function executeManagedVisionQa(
  input: ManagedVisionInput,
  deps: Partial<ManagedVisionExecutorDependencies> = {},
): Promise<{ provider: DirectorModelTarget['provider']; model: string; content: string }> {
  const dependencies = { ...defaultDependencies(), ...deps }
  const target = await dependencies.resolveTarget()
  const messages = buildMessages(input)
  const handle = await dependencies.gateway.begin({
    attemptId: input.attemptId,
    invocationNo: billingInvocationNo('vision-qa', input.invocationIndex),
    provider: target.provider,
    model: target.modelId,
    capability: 'vision',
    rawInput: JSON.stringify(messages),
    maxOutputTokens: VISION_QA_MAX_OUTPUT_TOKENS,
  })
  const apiKey = handle.credential ?? target.apiKey
  if (!apiKey) {
    await handle.releaseBeforeCall()
    throw new Error(
      `${PROVIDER_REGISTRY[target.provider].label} API Key 未配置，无法执行 Vision QA`,
    )
  }
  try {
    const completion = await dependencies.complete({
      apiKey,
      baseUrl: target.baseUrl,
      model: target.modelId,
      messages,
      maxOutputTokens: VISION_QA_MAX_OUTPUT_TOKENS,
    })
    if (!completion.content) {
      await settleVision(handle, completion, true)
      throw new Error('Vision 模型未返回报告')
    }
    await settleVision(handle, completion, false)
    return {
      provider: target.provider,
      model: target.modelId,
      content: completion.content,
    }
  } catch (error) {
    await handle.settleUnavailable(true)
    throw error
  }
}

function defaultDependencies(): ManagedVisionExecutorDependencies {
  return {
    resolveTarget: () => resolveDirectorModelTarget('shot-qa', 'vision'),
    gateway: new ManagedAiGateway(),
    complete: async (input) => {
      const response = await fetch(
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
      if (!response.ok) throw managedUpstreamError(response.status)
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
): Promise<void> {
  if (!completion.usage) {
    await handle.settleUnavailable(failed)
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
