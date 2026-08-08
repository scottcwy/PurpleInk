export type AiProviderErrorCode =
  | 'AI_CONFIG_INVALID'
  | 'AI_TIMEOUT'
  | 'AI_RATE_LIMITED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_OUTPUT_INVALID'

export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'AiProviderError'
  }
}

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

export function createOpenAiCompatibleClient(
  config: OpenAiCompatibleConfig,
): AiClient {
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
  endpoint: string
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
  let base: URL
  try {
    base = new URL(config.baseUrl)
  } catch (error) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'AI provider URL 无效', {
      cause: error,
    })
  }
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'AI provider URL 协议无效')
  }
  const requestTimeoutMs = config.requestTimeoutMs ?? 120_000
  const maxRetries = config.maxRetries ?? 2
  const retryBaseDelayMs = config.retryBaseDelayMs ?? 250
  if (
    !Number.isInteger(requestTimeoutMs)
    || requestTimeoutMs < 100
    || !Number.isInteger(maxRetries)
    || maxRetries < 0
    || maxRetries > 5
    || !Number.isInteger(retryBaseDelayMs)
    || retryBaseDelayMs < 0
  ) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'AI provider 重试配置无效')
  }
  return {
    endpoint: `${config.baseUrl.replace(/\/+$/u, '')}/chat/completions`,
    apiKey: config.apiKey,
    textModel: config.textModel,
    requestTimeoutMs,
    maxRetries,
    retryBaseDelayMs,
  }
}

async function requestCompletion(
  config: NormalizedConfig,
  input: AiCompletionInput,
  json: boolean,
): Promise<string> {
  const model = input.model?.trim() || config.textModel
  if (!model) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'AI model 未配置')
  }

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    input.signal?.throwIfAborted()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    const onAbort = (): void => controller.abort(input.signal?.reason)
    input.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        if (retryable && attempt < config.maxRetries) {
          await delay(backoffMs(config.retryBaseDelayMs, attempt))
          continue
        }
        throw new AiProviderError(
          response.status === 429
            ? 'AI_RATE_LIMITED'
            : 'AI_PROVIDER_UNAVAILABLE',
          response.status === 429 ? 'AI provider 请求受限' : 'AI provider 请求失败',
        )
      }
      const payload = (await response.json()) as ChatCompletionResponse
      const content = extractContent(payload)
      if (!content) {
        throw new AiProviderError('AI_OUTPUT_INVALID', 'AI provider 返回内容为空')
      }
      return content
    } catch (error) {
      if (error instanceof AiProviderError) throw error
      if (input.signal?.aborted) throw input.signal.reason ?? error
      if (controller.signal.aborted) {
        if (attempt < config.maxRetries) {
          await delay(backoffMs(config.retryBaseDelayMs, attempt))
          continue
        }
        throw new AiProviderError('AI_TIMEOUT', 'AI provider 请求超时', {
          cause: error,
        })
      }
      if (attempt < config.maxRetries) {
        await delay(backoffMs(config.retryBaseDelayMs, attempt))
        continue
      }
      throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider 暂时不可用', {
        cause: error,
      })
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', onAbort)
    }
  }
  throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider 请求未完成')
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

function backoffMs(base: number, attempt: number): number {
  return Math.min(30_000, base * 2 ** attempt)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
