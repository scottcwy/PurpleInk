import { randomUUID } from 'node:crypto'

export type ProviderFunding = 'managed' | 'byok'

export type ProviderFailureKind =
  | 'auth'
  | 'balance'
  | 'permission'
  | 'rate_limit'
  | 'request'
  | 'safety'
  | 'timeout'
  | 'unavailable'
  | 'network'
  | 'unknown'

export interface ProviderRequestErrorOptions {
  providerId: string
  providerLabel: string
  operation: string
  funding: ProviderFunding
  httpStatus?: number
  retryAt?: Date
  requestId?: string
  kind?: ProviderFailureKind
  cause?: unknown
}

/**
 * 出网边界唯一允许向工作流层传递的 Provider 异常。
 *
 * message 由安全元数据生成，不包含响应正文、Prompt、凭据或工具参数。原始异常只保留
 * 在内存中的 cause，不能序列化进节点、Artifact 或 task_attempts.failure。
 */
export class ProviderRequestError extends Error {
  override readonly name: string = 'ProviderRequestError'
  readonly providerId: string
  readonly providerLabel: string
  readonly operation: string
  readonly funding: ProviderFunding
  readonly httpStatus?: number
  readonly retryAt?: string
  readonly requestId?: string
  readonly kind: ProviderFailureKind
  readonly referenceId: string
  readonly occurredAt: string

  constructor(options: ProviderRequestErrorOptions) {
    const kind = options.kind ?? providerFailureKind(options.httpStatus)
    super(safeProviderMessage(options.providerLabel, options.operation, kind))
    this.providerId = options.providerId
    this.providerLabel = options.providerLabel
    this.operation = options.operation
    this.funding = options.funding
    this.httpStatus = options.httpStatus
    this.retryAt = options.retryAt?.toISOString()
    this.requestId = options.requestId
    this.kind = kind
    this.referenceId = randomUUID()
    this.occurredAt = new Date().toISOString()
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export function providerFailureKind(status?: number): ProviderFailureKind {
  if (status === 401) return 'auth'
  if (status === 402) return 'balance'
  if (status === 403) return 'permission'
  if (status === 429) return 'rate_limit'
  if (status === 451) return 'safety'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'request'
  if (status !== undefined && status >= 500) return 'unavailable'
  return 'unknown'
}

export function providerErrorFromResponse(input: {
  response: Pick<Response, 'status'> & { headers?: Headers | Record<string, string> }
  providerId: string
  providerLabel: string
  operation: string
  funding: ProviderFunding
}): ProviderRequestError {
  return new ProviderRequestError({
    ...input,
    httpStatus: input.response.status,
    retryAt: parseRetryAfter(readHeader(input.response.headers, 'retry-after')),
    requestId: input.response.headers
      ? safeRequestId(input.response.headers)
      : undefined,
  })
}

export function providerNetworkError(input: Omit<ProviderRequestErrorOptions, 'kind'>): ProviderRequestError {
  const timeout = isTimeoutError(input.cause)
  return new ProviderRequestError({
    ...input,
    kind: timeout ? 'timeout' : 'network',
  })
}

export function parseRetryAfter(value: string | null, now = new Date()): Date | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now.getTime() + seconds * 1_000)
  }
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp)
}

function safeRequestId(headers: Headers | Record<string, string>): string | undefined {
  for (const name of ['x-request-id', 'request-id', 'x-trace-id']) {
    const value = readHeader(headers, name)?.trim()
    if (value && /^[a-zA-Z0-9._:-]{1,128}$/.test(value)) return value
  }
  return undefined
}

function readHeader(
  headers: Headers | Record<string, string> | undefined,
  name: string
): string | null {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  return entry?.[1] ?? null
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function safeProviderMessage(
  providerLabel: string,
  operation: string,
  kind: ProviderFailureKind
): string {
  if (kind === 'rate_limit') return `${providerLabel} ${operation}请求过于频繁`
  if (kind === 'timeout') return `${providerLabel} ${operation}请求超时`
  if (kind === 'unavailable' || kind === 'network') return `${providerLabel} ${operation}服务暂时不可用`
  return `${providerLabel} ${operation}请求未完成`
}
