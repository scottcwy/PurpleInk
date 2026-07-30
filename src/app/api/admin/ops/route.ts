import { NextResponse } from 'next/server'
import { withAdminSession } from '@/features/auth/api-session'
import { getOpsSnapshot } from '@/features/admin/ops'

export const dynamic = 'force-dynamic'

/** 系统运维快照：DB/worker 健康、队列深度、供应商 RPM/TPM 占用。 */
export function GET(): Promise<Response> {
  return withAdminSession(async () => {
    const snapshot = await getOpsSnapshot()
    return NextResponse.json({ ok: true, ...snapshot })
  })
}
