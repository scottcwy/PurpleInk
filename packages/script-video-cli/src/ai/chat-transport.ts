import { AiProviderError } from './provider-error'

export interface ChatTransportConfig {
  baseUrl: string
  apiKey: string
  requestTimeoutMs?: number
  maxRetries?: number
  retryBaseDelayMs?: number
}

export interface ChatTransportDependencies {
  fetch?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
}

export async function requestChatCompletion(
  config: ChatTransportConfig,
  body: Readonly<Record<string, unknown>>,
  options: ChatTransportDependencies & { signal?: AbortSignal } = {},
): Promise<unknown> {
  const normalized = normalizeTransportConfig(config)
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const sleep = options.sleep ?? delay
  const random = options.random ?? Math.random

  for (let attempt = 0; attempt <= normalized.maxRetries; attempt += 1) {
    options.signal?.throwIfAborted()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), normalized.requestTimeoutMs)
    const onAbort = (): void => controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetchImplementation(normalized.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${normalized.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        if (retryable && attempt < normalized.maxRetries) {
          await sleep(backoffMs(normalized.retryBaseDelayMs, attempt, random))
          continue
        }
        throw new AiProviderError(
          response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_UNAVAILABLE',
          response.status === 429 ? 'AI provider 请求受限' : 'AI provider 请求失败',
        )
      }
      try {
        return (await response.json()) as unknown
      } catch {
        throw new AiProviderError('AI_OUTPUT_INVALID', 'AI provider 返回格式无效')
      }
    } catch (error) {
      if (error instanceof AiProviderError) throw error
      if (options.signal?.aborted) throw options.signal.reason ?? error
      if (controller.signal.aborted) {
        if (attempt < normalized.maxRetries) {
          await sleep(backoffMs(normalized.retryBaseDelayMs, attempt, random))
          continue
        }
        throw new AiProviderError('AI_TIMEOUT', 'AI provider 请求超时', { cause: error })
      }
      if (attempt < normalized.maxRetries) {
        await sleep(backoffMs(normalized.retryBaseDelayMs, attempt, random))
        continue
      }
      throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider 暂时不可用', { cause: error })
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }
  throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider 请求未完成')
}

export function chatCompletionEndpoint(baseUrl: string): string {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch (error) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'AI provider URL 无效', { cause: error })
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new AiProviderError('AI_CONFIG_INVALID', 'AI provider URL 协议无效')
  }
  if (base.hash) throw new AiProviderError('AI_CONFIG_INVALID', 'AI provider URL 不能包含 fragment')
  const path = base.pathname.replace(/\/+$/u, '')
  base.pathname = `${path}/chat/completions`
  return base.toString()
}

interface NormalizedTransportConfig {
  endpoint: string
  apiKey: string
  requestTimeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
}

function normalizeTransportConfig(config: ChatTransportConfig): NormalizedTransportConfig {
  const requestTimeoutMs = config.requestTimeoutMs ?? 120_000
  const maxRetries = config.maxRetries ?? 2
  const retryBaseDelayMs = config.retryBaseDelayMs ?? 250
  if (!config.apiKey.trim()) throw new AiProviderError('AI_CONFIG_INVALID', 'AI provider 密钥未配置')
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
    endpoint: chatCompletionEndpoint(config.baseUrl),
    apiKey: config.apiKey,
    requestTimeoutMs,
    maxRetries,
    retryBaseDelayMs,
  }
}

function backoffMs(base: number, attempt: number, random: () => number): number {
  return Math.min(30_000, base * 2 ** attempt + Math.floor(base * Math.max(0, Math.min(1, random()))))
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
