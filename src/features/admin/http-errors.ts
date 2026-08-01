import { BillingAdminError } from './billing-admin'
import { UserAdminError } from './user-admin'

export function adminErrorResponse(error: unknown): Response {
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

export async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
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
