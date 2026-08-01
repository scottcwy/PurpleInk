import { revokeRedemptionBatch } from '@/features/admin'
import { adminErrorResponse, jsonObject } from '@/features/admin/http-errors'
import { withAdminSession } from '@/features/auth'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, context: {
  params: Promise<{ id: string }>
}): Promise<Response> {
  return withAdminSession(async () => {
    try {
      const [{ id }, body] = await Promise.all([context.params, jsonObject(request)])
      if (body.action !== 'revoke' || body.confirmation !== 'REVOKE') {
        return Response.json({ ok: false, error: '需要确认撤销批次' }, { status: 400 })
      }
      await revokeRedemptionBatch({ batchId: id })
      return Response.json({ ok: true })
    } catch (error) {
      return adminErrorResponse(error)
    }
  }, { routeGroup: 'admin-billing-batches' })
}
