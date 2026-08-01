import { createRedemptionBatch } from '@/features/admin'
import {
  adminErrorResponse,
  parseOptionalFutureDate,
  readAdminMutationJson,
} from '@/features/admin/http-errors'
import { withAdminSession } from '@/features/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  return withAdminSession(async (session) => {
    try {
      const body = await readAdminMutationJson(request)
      if (body.planKey !== 'plus' && body.planKey !== 'pro' && body.planKey !== 'max') {
        return Response.json({ ok: false, error: '兑换方案不正确' }, { status: 400 })
      }
      const expiresAt = parseOptionalFutureDate(body.expiresAt)
      const result = await createRedemptionBatch({
        actorUserId: session.userId,
        planKey: body.planKey,
        label: typeof body.label === 'string' ? body.label : '',
        count: typeof body.count === 'number' ? body.count : 0,
        expiresAt,
      })
      return Response.json({ ok: true, ...result }, { status: 201 })
    } catch (error) {
      return adminErrorResponse(error)
    }
  }, { routeGroup: 'admin-billing-batches' })
}
