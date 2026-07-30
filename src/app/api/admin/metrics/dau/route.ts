import { NextResponse } from 'next/server'
import { withAdminSession } from '@/features/auth/api-session'
import { getDauMetrics } from '@/features/admin/metrics'

export const dynamic = 'force-dynamic'

/** DAU/活跃统计：?days=30（1..90）。口径见 features/admin/metrics.ts。 */
export function GET(request: Request): Promise<Response> {
  return withAdminSession(async () => {
    const raw = Number(new URL(request.url).searchParams.get('days'))
    const days = Number.isSafeInteger(raw) && raw > 0 ? raw : 30
    const metrics = await getDauMetrics(days)
    return NextResponse.json({ ok: true, ...metrics })
  })
}
