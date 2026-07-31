import { NextResponse } from 'next/server'
import { currentSession } from '@/features/auth/api-session'

export const dynamic = 'force-dynamic'

/**
 * 当前登录态的最小视图（PLAN-002 §3.3），供客户端「AI 动作前是否需要弹登录框」
 * 判断使用。
 *
 * 只回 `authenticated` 与展示所需的两个字段，不回 userId / workspaceId / 会话 id
 * ——那些是内部标识，客户端不需要，回了只会扩大泄露面。
 */
export async function GET() {
  const session = await currentSession()
  const body = session
    ? {
        authenticated: true as const,
        email: session.email,
        name: session.name,
        workspaceName: session.workspaceName,
      }
    : { authenticated: false as const }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
