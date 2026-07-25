import { NextResponse } from 'next/server'
import { VERIFICATION_CODE_SENT_MESSAGE, authFailure } from '@/features/auth/errors'
import { authFailureResponse, readJsonBody, requestFingerprint } from '@/features/auth/http'
import { requestVerificationCodeSchema } from '@/features/auth/schemas'
import { requestVerificationCode } from '@/features/auth/verification-service'

export const dynamic = 'force-dynamic'

/**
 * 签发注册验证码。
 *
 * 无论该邮箱是否已注册，都回同一个 200 与同一句文案；是否真的发信由服务端决定
 * （PLAN-002 §3.4）。
 */
export async function POST(request: Request) {
  const parsed = requestVerificationCodeSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return authFailureResponse(authFailure('invalid-input'))

  const result = await requestVerificationCode({
    ...parsed.data,
    purpose: 'signup',
    ip: requestFingerprint(request).ip,
  })
  if (!result.ok) return authFailureResponse(result)
  return NextResponse.json({ ok: true, message: VERIFICATION_CODE_SENT_MESSAGE })
}
