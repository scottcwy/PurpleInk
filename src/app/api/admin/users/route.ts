import { createAdminUser, listAdminUsers } from '@/features/admin'
import {
  adminErrorResponse,
  readAdminMutationJson,
} from '@/features/admin/http-errors'
import { positiveQueryInteger } from '@/features/admin/http-query'
import { withAdminSession } from '@/features/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return withAdminSession(async () => {
    const query = new URL(request.url).searchParams
    const page = await listAdminUsers({
      q: query.get('q') ?? undefined,
      page: positiveQueryInteger(query.get('page'), 1, 10_000),
      pageSize: positiveQueryInteger(query.get('pageSize'), 50, 100),
    })
    return Response.json({ ok: true, ...page })
  }, { routeGroup: 'admin-users' })
}

export async function POST(request: Request): Promise<Response> {
  return withAdminSession(async () => {
    try {
      const body = await readAdminMutationJson(request)
      const created = await createAdminUser({
        email: typeof body.email === 'string' ? body.email : '',
        name: typeof body.name === 'string' ? body.name : '',
        password: typeof body.password === 'string' ? body.password : '',
        workspaceName: typeof body.workspaceName === 'string' ? body.workspaceName : '',
      })
      return Response.json({ ok: true, user: created }, { status: 201 })
    } catch (error) {
      return adminErrorResponse(error)
    }
  }, { routeGroup: 'admin-users' })
}
