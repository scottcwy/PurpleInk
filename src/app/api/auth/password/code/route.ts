import { NextResponse } from 'next/server'
import { VERIFICATION_CODE_SENT_MESSAGE, authFailure } from '@/features/auth/errors'
import { authFailureResponse, readJsonBody, requestFingerprint } from '@/features/auth/http'
import { requestVerificationCodeSchema } from '@/features/auth/schemas'
import { requestVerificationCode } from '@/features/auth/verification-service'

export const dynamic = 'force-dynamic'

/**
 * 签发重置口令验证码。
 *
 * 忘记密码是账号枚举最常见的入口，因此「邮箱未注册」也必须回同一个 200 与
 * 同一句文案（PLAN-002 §3.4）。
 */
export async function POST(request: Request) {
  const parsed = requestVerificationCodeSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return authFailureResponse(authFailure('invalid-input'))

  const result = await requestVerificationCode({
    ...parsed.data,
    purpose: 'password_reset',
    ip: requestFingerprint(request).ip,
  })
  if (!result.ok) return authFailureResponse(result)
  return NextResponse.json({ ok: true, message: VERIFICATION_CODE_SENT_MESSAGE })
}
