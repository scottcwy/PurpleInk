import { BillingAdminError } from './billing-admin'
import { UserAdminError } from './user-admin'

type AdminRequestErrorCode =
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'CROSS_SITE_REQUEST'
  | 'INVALID_JSON'
  | 'INVALID_RESOURCE_ID'

export class AdminRequestError extends Error {
  constructor(
    readonly code: AdminRequestErrorCode,
    readonly status: 400 | 403 | 415,
    message: string,
  ) {
    super(message)
    this.name = 'AdminRequestError'
  }
}

export function adminErrorResponse(error: unknown): Response {
  if (error instanceof AdminRequestError) {
    return Response.json(
      { ok: false, code: error.code, error: error.message },
      { status: error.status },
    )
  }
  if (error instanceof UserAdminError) {
    const status = error.code === 'USER_NOT_FOUND'
      ? 404
      : error.code === 'EMAIL_IN_USE'
        ? 409
        : 400
    return Response.json({ ok: false, code: error.code, error: error.message }, { status })
  }
  if (error instanceof BillingAdminError) {
    return Response.json(
      { ok: false, code: error.code, error: error.message },
      { status: error.code === 'BATCH_NOT_FOUND' ? 404 : 400 },
    )
  }
  throw error
}

export async function readAdminMutationJson(request: Request): Promise<Record<string, unknown>> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new AdminRequestError(
      'UNSUPPORTED_MEDIA_TYPE',
      415,
      '管理操作只接受 application/json',
    )
  }
  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')
  if (origin && origin !== requestOrigin) {
    throw new AdminRequestError('CROSS_SITE_REQUEST', 403, '拒绝跨站管理操作')
  }
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new AdminRequestError('CROSS_SITE_REQUEST', 403, '拒绝跨站管理操作')
  }
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new AdminRequestError('INVALID_JSON', 400, 'JSON 请求体格式不正确')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminRequestError('INVALID_JSON', 400, 'JSON 请求体必须是对象')
  }
  return value as Record<string, unknown>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseAdminUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new AdminRequestError('INVALID_RESOURCE_ID', 400, '资源标识格式不正确')
  }
  return value.toLowerCase()
}

export function parseOptionalFutureDate(value: unknown, now = new Date()): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new BillingAdminError('INVALID_INPUT')
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date <= now) {
    throw new BillingAdminError('INVALID_INPUT')
  }
  return date
}
