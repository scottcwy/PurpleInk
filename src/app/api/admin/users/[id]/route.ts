import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAdminSession } from '@/features/auth/api-session'
import { displayNameSchema, passwordSchema } from '@/features/auth/schemas'
import {
  deleteAdminUser,
  updateAdminUser,
  type AdminUserMutationResult,
} from '@/features/admin/user-admin'

export const dynamic = 'force-dynamic'

const patchSchema = z
  .object({
    name: displayNameSchema.optional(),
    status: z.enum(['active', 'disabled']).optional(),
    role: z.enum(['user', 'admin']).optional(),
    password: passwordSchema.optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    '至少提供一个待更新字段',
  )

/**
 * 更新账号（改名/启停/改角色/重置口令）。禁用与改口令即时踢下线；
 * 禁止 admin 对自己禁用/降级/删除（防止最后一个管理员自锁）。
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAdminSession(async (session) => {
    const { id } = await params
    const body: unknown = await request.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? '输入无效' },
        { status: 400 },
      )
    }
    const result = await updateAdminUser({
      userId: id,
      actorUserId: session.userId,
      patch: parsed.data,
    })
    return mutationResponse(result)
  }, { routeGroup: 'PATCH /api/admin/users/:id' })
}

export function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAdminSession(async (session) => {
    const { id } = await params
    const result = await deleteAdminUser({ userId: id, actorUserId: session.userId })
    return mutationResponse(result)
  }, { routeGroup: 'DELETE /api/admin/users/:id' })
}

function mutationResponse(result: AdminUserMutationResult): Response {
  if (result.ok) return NextResponse.json({ ok: true, userId: result.userId })
  if (result.code === 'not-found') {
    return NextResponse.json({ ok: false, error: '用户不存在' }, { status: 404 })
  }
  if (result.code === 'self-forbidden') {
    return NextResponse.json(
      { ok: false, error: '不能对自己执行禁用、降级或删除' },
      { status: 400 },
    )
  }
  return NextResponse.json({ ok: false, error: '该邮箱已被注册' }, { status: 409 })
}
