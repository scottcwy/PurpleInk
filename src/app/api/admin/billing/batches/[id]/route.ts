import { NextResponse } from 'next/server'
import { withAdminSession } from '@/features/auth/api-session'
import { revokeRedemptionBatch } from '@/features/billing'

export const dynamic = 'force-dynamic'

/** 撤销兑换码批次：整批码随即不可兑换（destructive，前端二次确认）。 */
export function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAdminSession(async () => {
    const { id } = await params
    const result = await revokeRedemptionBatch(id)
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: '批次不存在' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  }, { routeGroup: 'PATCH /api/admin/billing/batches/:id' })
}
