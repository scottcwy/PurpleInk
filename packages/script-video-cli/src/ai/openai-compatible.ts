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
        return parseJsonResponse(text)
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
      max_tokens: json ? 4_096 : 16_384,
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

function parseJsonResponse(value: string): unknown {
  const normalized = stripJsonFence(value)
  try {
    return JSON.parse(normalized) as unknown
  } catch {
    for (const candidate of topLevelJsonCandidates(normalized)) {
      try {
        return JSON.parse(candidate) as unknown
      } catch {
        // Continue to the next complete object or array.
      }
    }
    throw new SyntaxError('No valid JSON value found')
  }
}

function topLevelJsonCandidates(value: string): string[] {
  const candidates: string[] = []
  for (let start = 0; start < value.length; start += 1) {
    const opening = value[start]
    if (opening !== '{' && opening !== '[') continue
    const closing = opening === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') {
        inString = true
        continue
      }
      if (character === opening) depth += 1
      else if (character === closing) depth -= 1
      if (depth === 0) {
        candidates.push(value.slice(start, index + 1))
        break
      }
    }
  }
  return candidates
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
