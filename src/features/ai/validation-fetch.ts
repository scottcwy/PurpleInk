import 'server-only'
import { randomUUID } from 'node:crypto'
import {
  createUnbilledInvocation,
  markProviderInvocationStarted,
  settleUnbilledInvocation,
  type InvocationFunding,
} from './invocation-ledger'

/**
 * 设置验证专用 fetch 包装：每次真实 HTTP 都单独建账，但从不保存请求体、Key 或响应正文。
 */
export function createAuditedValidationFetcher(input: {
  provider: string
  funding: Exclude<InvocationFunding, 'managed'>
  fetcher?: typeof fetch
}): typeof fetch {
  const fetcher = input.fetcher ?? fetch
  return async (url, init) => {
    const metadata = probeMetadata(url, init)
    const invocationId = randomUUID()
    await createUnbilledInvocation({
      invocationId,
      invocationNo: 1,
      provider: input.provider,
      model: metadata.model,
      funding: input.funding,
      capability: metadata.capability,
      operation: 'credential-validation',
      source: 'products.settings',
    })
    await markProviderInvocationStarted(invocationId)
    const startedAt = performance.now()
    try {
      const response = await fetcher(url, init)
      await settleUnbilledInvocation({
        invocationId,
        status: response.ok ? 'succeeded' : 'failed',
        usageStatus: 'unavailable',
        usage: {
          schemaVersion: 2,
          capability: metadata.capability,
          unavailable: true,
        },
        providerDurationMs: elapsed(startedAt),
        failureKind: response.ok ? undefined : httpFailureKind(response.status),
      })
      return response
    } catch (error) {
      await settleUnbilledInvocation({
        invocationId,
        status: 'failed',
        usageStatus: 'unavailable',
        usage: {
          schemaVersion: 2,
          capability: metadata.capability,
          unavailable: true,
        },
        providerDurationMs: elapsed(startedAt),
        failureKind: error instanceof DOMException && error.name === 'TimeoutError'
          ? 'timeout'
          : 'network',
      })
      throw error
    }
  }
}

function probeMetadata(
  url: string | URL | Request,
  init?: RequestInit,
): {
  capability: 'text' | 'vision' | 'tts' | 'asr'
  model: string
} {
  const href = typeof url === 'string'
    ? url
    : url instanceof URL
      ? url.href
      : url.url
  const body = parseJsonBody(init?.body)
  if (href.includes('/audio/speech')) {
    return { capability: 'tts', model: stringField(body, 'model') }
  }
  if (href.includes('/audio/transcriptions') || href.endsWith('/models')) {
    return { capability: 'asr', model: stringField(body, 'model') }
  }
  const serialized = body ? JSON.stringify(body) : ''
  return {
    capability: serialized.includes('"image_url"') ? 'vision' : 'text',
    model: stringField(body, 'model'),
  }
}

function parseJsonBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(body)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function stringField(
  value: Record<string, unknown> | null,
  key: string,
): string {
  const field = value?.[key]
  return typeof field === 'string' && field.trim()
    ? field.trim()
    : 'credential-endpoint'
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

function httpFailureKind(status: number): string {
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'authentication'
  if (status >= 500) return 'unavailable'
  return 'rejected'
}
