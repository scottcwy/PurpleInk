import { getAdminBilling } from '@/features/admin'
import { positiveQueryInteger } from '@/features/admin/http-query'
import { withAdminSession } from '@/features/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return withAdminSession(async () => {
    const query = new URL(request.url).searchParams
    const snapshot = await getAdminBilling({
      page: positiveQueryInteger(query.get('page'), 1, 10_000),
      pageSize: positiveQueryInteger(query.get('pageSize'), 50, 100),
    })
    return Response.json({ ok: true, ...snapshot })
  }, { routeGroup: 'admin-billing' })
}
