import { NextResponse } from 'next/server'
import { registerAccount } from '@/features/auth/account-service'
import { authFailure } from '@/features/auth/errors'
import { authFailureResponse, readJsonBody, requestFingerprint } from '@/features/auth/http'
import { safeNextPath } from '@/features/auth/next-path'
import { signupSchema } from '@/features/auth/schemas'
import { attachSessionCookie } from '@/lib/auth/session-cookie'

export const dynamic = 'force-dynamic'

/**
 * 注册：校验验证码 → 单事务创建 user + workspace + owner 成员关系 → 签发会话。
 * 三张表同生同死，任一步失败全回滚（PLAN-002 §3.3 / §8.2）。
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request)
  const parsed = signupSchema.safeParse(body)
  if (!parsed.success) return authFailureResponse(authFailure('invalid-input'))

  const result = await registerAccount({
    ...parsed.data,
    fingerprint: requestFingerprint(request),
  })
  if (!result.ok) return authFailureResponse(result)

  const redirectTo = safeNextPath(
    typeof body === 'object' && body !== null
      ? (body as { next?: unknown }).next?.toString()
      : null,
  )
  const response = NextResponse.json({ ok: true, redirectTo }, { status: 201 })
  attachSessionCookie(response, result.session.token, result.session.expiresAt)
  return response
}
