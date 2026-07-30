import { NextResponse } from 'next/server'
import { withAdminSession } from '@/features/auth/api-session'
import { getAiAuditMetrics } from '@/features/admin/ai-audit'

export const dynamic = 'force-dynamic'

/** AI 调用审计：跨 workspace 聚合（?days=30，默认 30，上限 90）。 */
export function GET(request: Request): Promise<Response> {
  return withAdminSession(async () => {
    const url = new URL(request.url)
    const days = Number(url.searchParams.get('days'))
    const metrics = await getAiAuditMetrics(Number.isFinite(days) && days > 0 ? days : undefined)
    return NextResponse.json({ ok: true, ...metrics })
  }, { routeGroup: 'GET /api/admin/ai' })
}
