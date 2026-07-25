import { NextResponse } from 'next/server'
import { issueChallenge } from '@/features/auth/human-check-service'

export const dynamic = 'force-dynamic'

/**
 * 下发算术验证码与其签名 token（PLAN-002 §1.6 第 3 项）。
 *
 * 公开端点：未登录用户必须能取到挑战。答案不在响应里，只以带密钥摘要存在于
 * token 中；挑战不落库。`no-store` 是必须的——缓存会让所有人拿到同一道题。
 */
export async function GET() {
  const challenge = issueChallenge()
  return NextResponse.json(
    { token: challenge.token, question: challenge.question, svg: challenge.svg },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
