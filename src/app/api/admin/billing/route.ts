import { NextResponse } from 'next/server'
import { withAdminSession } from '@/features/auth/api-session'
import { getBillingOverview, listRedemptionBatches } from '@/features/admin/billing-admin'

export const dynamic = 'force-dynamic'

/** 计费总览：套餐分布 + 兑换码批次列表（?page=&pageSize=）。 */
export function GET(request: Request): Promise<Response> {
  return withAdminSession(async () => {
    const url = new URL(request.url)
    const [overview, batches] = await Promise.all([
      getBillingOverview(),
      listRedemptionBatches({
        page: readInt(url.searchParams.get('page'), 1),
        pageSize: readInt(url.searchParams.get('pageSize'), 20),
      }),
    ])
    return NextResponse.json({ ok: true, ...overview, ...batches })
  }, { routeGroup: 'GET /api/admin/billing' })
}

function readInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}
