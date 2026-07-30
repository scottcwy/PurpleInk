import { NextResponse } from 'next/server'
import { withAdminSession } from '@/features/auth/api-session'
import { getSecuritySnapshot } from '@/features/admin/security'

export const dynamic = 'force-dynamic'

/** 安全监控快照：接口访问统计 + 限流/攻击信号。 */
export function GET(): Promise<Response> {
  return withAdminSession(async () => {
    const snapshot = await getSecuritySnapshot()
    return NextResponse.json({ ok: true, ...snapshot })
  }, { routeGroup: 'GET /api/admin/security' })
}
