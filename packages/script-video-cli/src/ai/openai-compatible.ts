import { chatCompletionEndpoint, requestChatCompletion } from './chat-transport'
import { AiProviderError } from './provider-error'

export { AiProviderError } from './provider-error'
export type { AiProviderErrorCode } from './provider-error'

export interface OpenAiCompatibleConfig {
  baseUrl: string
  apiKey: string
  textModel: string
  visionModel?: string
  requestTimeoutMs?: number
  maxRetries?: number
  retryBaseDelayMs?: number
}

export interface AiCompletionInput {
  system: string
  user: string
  model?: string
  signal?: AbortSignal
}

export interface AiClient {
  completeText(input: AiCompletionInput): Promise<string>
  completeJson(input: AiCompletionInput): Promise<unknown>
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>
}

export function createOpenAiCompatibleClient(config: OpenAiCompatibleConfig): AiClient {
  const normalized = normalizeConfig(config)

  return {
    completeText: (input) => requestCompletion(normalized, input, false),
    completeJson: async (input) => {
      const text = await requestCompletion(normalized, input, true)
      try {
        return JSON.parse(stripJsonFence(text)) as unknown
      } catch (error) {
        throw new AiProviderError('AI_OUTPUT_INVALID', 'AI 返回不是有效 JSON', {
          cause: error,
        })
      }
    },
  }
}

interface NormalizedConfig {
  baseUrl: string
  apiKey: string
  textModel: string
  requestTimeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
}

function normalizeConfig(config: OpenAiCompatibleConfig): NormalizedConfig {
  if (!config.apiKey.trim() || !config.textModel.trim()) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'AI provider 配置不完整')
  }
  chatCompletionEndpoint(config.baseUrl)
  const requestTimeoutMs = config.requestTimeoutMs ?? 120_000
  const maxRetries = config.maxRetries ?? 2
  const retryBaseDelayMs = config.retryBaseDelayMs ?? 250
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 100 ||
    !Number.isInteger(maxRetries) ||
    maxRetries < 0 ||
    maxRetries > 5 ||
    !Number.isInteger(retryBaseDelayMs) ||
    retryBaseDelayMs < 0
  ) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'AI provider 重试配置无效')
  }
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    textModel: config.textModel,
    requestTimeoutMs,
    maxRetries,
    retryBaseDelayMs,
  }
}

async function requestCompletion(config: NormalizedConfig, input: AiCompletionInput, json: boolean): Promise<string> {
  const model = input.model?.trim() || config.textModel
  if (!model) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'AI model 未配置')
  }

  const payload = (await requestChatCompletion(
    config,
    {
      model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    },
    { signal: input.signal },
  )) as ChatCompletionResponse
  const content = extractContent(payload)
  if (!content) throw new AiProviderError('AI_OUTPUT_INVALID', 'AI provider 返回内容为空')
  return content
}

function extractContent(payload: ChatCompletionResponse): string | null {
  const value = payload.choices?.[0]?.message?.content
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return null
  const text = value
    .filter((part): part is { type?: unknown; text?: unknown } => isRecord(part))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim()
  return text || null
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
