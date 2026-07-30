import { NextResponse } from 'next/server'
import { withAdminSession } from '@/features/auth/api-session'
import { getRenderJob } from '@/features/admin/render-jobs-admin'

export const dynamic = 'force-dynamic'

/** 任务详情（含 logs 时间线原始数据；阶段耗时由前端按相邻日志时间差计算）。 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAdminSession(async () => {
    const { id } = await params
    // id 由 worker randomUUID() 生成；先做形状校验，坏输入不进 SQL。
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ ok: false, error: '任务不存在' }, { status: 404 })
    }
    const job = await getRenderJob(id)
    if (!job) {
      return NextResponse.json({ ok: false, error: '任务不存在' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, job })
  }, { routeGroup: 'GET /api/admin/jobs/:id' })
}
