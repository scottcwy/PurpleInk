import { NextResponse } from 'next/server'
import { resetPassword } from '@/features/auth/account-service'
import { authFailure } from '@/features/auth/errors'
import { authFailureResponse, readJsonBody, requestFingerprint } from '@/features/auth/http'
import { DEFAULT_POST_LOGIN_PATH } from '@/features/auth/next-path'
import { resetPasswordSchema } from '@/features/auth/schemas'
import { attachSessionCookie } from '@/lib/auth/session-cookie'

export const dynamic = 'force-dynamic'

/**
 * 重置口令：校验验证码 → 更新哈希与 `passwordUpdatedAt` → **失效该用户全部会话**，
 * 然后为当前请求重新签发一条（PLAN-002 §3.3）。
 *
 * 「改密即全端登出」在数据层成立：既显式 DELETE 该用户的 sessions，也有
 * `passwordUpdatedAt <= sessions.createdAt` 这道兜底校验。
 */
export async function POST(request: Request) {
  const parsed = resetPasswordSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return authFailureResponse(authFailure('invalid-input'))

  const result = await resetPassword({
    ...parsed.data,
    fingerprint: requestFingerprint(request),
  })
  if (!result.ok) return authFailureResponse(result)

  const response = NextResponse.json({ ok: true, redirectTo: DEFAULT_POST_LOGIN_PATH })
  attachSessionCookie(response, result.session.token, result.session.expiresAt)
  return response
}
