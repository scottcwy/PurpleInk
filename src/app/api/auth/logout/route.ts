import { NextResponse } from 'next/server'
import { revokeSession } from '@/features/auth/session'
import { clearSessionCookie, readSessionToken } from '@/lib/auth/session-cookie'

export const dynamic = 'force-dynamic'

/**
 * 登出：删除服务端会话行 + 清 cookie。
 *
 * 删行是关键——只清 cookie 的话，被复制出去的 cookie 仍然有效。这也是本产品
 * 选 DB 会话而不是无状态 JWT 的直接收益（PLAN-002 §1.3）。
 *
 * 未登录时也回 200：登出是幂等操作，回 401 只会让客户端多一条无意义分支。
 */
export async function POST() {
  await revokeSession(await readSessionToken())
  const response = NextResponse.json({ ok: true })
  clearSessionCookie(response)
  return response
}
