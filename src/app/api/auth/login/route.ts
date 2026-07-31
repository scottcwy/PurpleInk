import { NextResponse } from 'next/server'
import { authenticate } from '@/features/auth/account-service'
import { authFailure } from '@/features/auth/errors'
import { authFailureResponse, readJsonBody, requestFingerprint } from '@/features/auth/http'
import { safeNextPath } from '@/features/auth/next-path'
import { loginSchema } from '@/features/auth/schemas'
import { attachSessionCookie } from '@/lib/auth/session-cookie'

export const dynamic = 'force-dynamic'

/**
 * 登录。账号不存在与口令错误走同一条 401 同一句文案，且两种情况都执行一次口令
 * 哈希校验，避免耗时差成为枚举信号（PLAN-002 §3.4）。
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) return authFailureResponse(authFailure('invalid-credentials'))

  const result = await authenticate({
    ...parsed.data,
    fingerprint: requestFingerprint(request),
  })
  if (!result.ok) return authFailureResponse(result)

  const redirectTo = safeNextPath(
    typeof body === 'object' && body !== null
      ? (body as { next?: unknown }).next?.toString()
      : null,
  )
  const response = NextResponse.json({ ok: true, redirectTo })
  attachSessionCookie(response, result.session.token, result.session.expiresAt)
  return response
}
