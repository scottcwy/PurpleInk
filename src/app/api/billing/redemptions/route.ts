import { NextResponse } from 'next/server'
import { redeemBillingCode } from '@/features/billing'
import { withApiSession } from '@/features/auth/api-session'

export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return withApiSession((session) => handlePost(request, session))
}

async function handlePost(
  request: Request,
  session: { userId: string; workspaceId: string },
): Promise<Response> {
  const body: unknown = await request.json().catch(() => null)
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? ''
  const code = readCode(body)
  if (!code || !validIdempotencyKey(idempotencyKey)) {
    return NextResponse.json(
      { ok: false, error: '兑换请求输入无效' },
      { status: 400 },
    )
  }

  try {
    const result = await redeemBillingCode({
      code,
      idempotencyKey,
      userId: session.userId,
      workspaceId: session.workspaceId,
    })
    if (!result.ok) {
      if (result.code === 'forbidden') {
        return forbiddenResponse()
      }
      return NextResponse.json(
        { ok: false, error: '兑换码无效或不可用' },
        { status: 400 },
      )
    }
    return NextResponse.json(result.projection)
  } catch (error) {
    const code = domainErrorCode(error)
    if (code === 'forbidden') {
      return forbiddenResponse()
    }
    if (code === 'redemption_conflict' || code === 'idempotency_conflict') {
      return NextResponse.json(
        { ok: false, error: '兑换请求冲突，请刷新后重试' },
        { status: 409 },
      )
    }
    if (code === 'code_unavailable') {
      return NextResponse.json(
        { ok: false, error: '兑换码无效或不可用' },
        { status: 400 },
      )
    }
    throw error
  }
}

function forbiddenResponse(): Response {
  return NextResponse.json(
    { ok: false, error: '仅工作区 Owner 可以使用兑换码' },
    { status: 403 },
  )
}

function readCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const code = (value as Record<string, unknown>).code
  if (typeof code !== 'string') return null
  const normalized = code.trim()
  return normalized.length >= 8 && normalized.length <= 256 ? normalized : null
}

function validIdempotencyKey(value: string): boolean {
  return value.length >= 8 && value.length <= 128
}

function domainErrorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const code = (value as Record<string, unknown>).code
  return typeof code === 'string' ? code : null
}
