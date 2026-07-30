import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAdminSession } from '@/features/auth/api-session'
import {
  displayNameSchema,
  emailSchema,
  passwordSchema,
} from '@/features/auth/schemas'
import { createAdminUser, listAdminUsers } from '@/features/admin/user-admin'

export const dynamic = 'force-dynamic'

/** 用户列表：?page=&pageSize=&q=（邮箱/姓名模糊搜索）。 */
export function GET(request: Request): Promise<Response> {
  return withAdminSession(async () => {
    const url = new URL(request.url)
    const result = await listAdminUsers({
      search: url.searchParams.get('q') ?? undefined,
      page: readInt(url.searchParams.get('page'), 1),
      pageSize: readInt(url.searchParams.get('pageSize'), 20),
    })
    return NextResponse.json({ ok: true, ...result })
  }, { routeGroup: 'GET /api/admin/users' })
}

const createUserSchema = z.object({
  email: emailSchema,
  name: displayNameSchema,
  password: passwordSchema,
  role: z.enum(['user', 'admin']).default('user'),
})

/** 管理端建号：跳过验证码，直接标记邮箱已验证（同 seed 脚本口径）。 */
export function POST(request: Request): Promise<Response> {
  return withAdminSession(async () => {
    const body: unknown = await request.json().catch(() => null)
    const parsed = createUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? '输入无效' },
        { status: 400 },
      )
    }
    const result = await createAdminUser(parsed.data)
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: '该邮箱已被注册' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, userId: result.userId })
  }, { routeGroup: 'POST /api/admin/users' })
}

function readInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}
