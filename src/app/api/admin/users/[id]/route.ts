import { updateAdminUser } from '@/features/admin'
import { adminErrorResponse, jsonObject } from '@/features/admin/http-errors'
import { withAdminSession } from '@/features/auth'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return withAdminSession(async (session) => {
    try {
      const [{ id }, body] = await Promise.all([context.params, jsonObject(request)])
      if (body.status === 'disabled') {
        return Response.json(
          { ok: false, error: '停用账号必须使用二次确认操作' },
          { status: 400 },
        )
      }
      const user = await updateAdminUser({
        actorUserId: session.userId,
        targetUserId: id,
        patch: {
          ...(typeof body.email === 'string' ? { email: body.email } : {}),
          ...(typeof body.name === 'string' ? { name: body.name } : {}),
          ...(body.status === 'active' ? { status: 'active' as const } : {}),
        },
      })
      return Response.json({ ok: true, user })
    } catch (error) {
      return adminErrorResponse(error)
    }
  }, { routeGroup: 'admin-users' })
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return withAdminSession(async (session) => {
    try {
      const [{ id }, body] = await Promise.all([context.params, jsonObject(request)])
      if (body.confirmation !== 'DISABLE') {
        return Response.json({ ok: false, error: '需要确认停用账号' }, { status: 400 })
      }
      const user = await updateAdminUser({
        actorUserId: session.userId,
        targetUserId: id,
        patch: { status: 'disabled' },
      })
      return Response.json({ ok: true, user })
    } catch (error) {
      return adminErrorResponse(error)
    }
  }, { routeGroup: 'admin-users' })
}
