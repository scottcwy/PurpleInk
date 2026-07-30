import { NextResponse } from 'next/server'
import { withAdminSession } from '@/features/auth/api-session'
import {
  listRenderJobs,
  type RenderJobStatus,
} from '@/features/admin/render-jobs-admin'
import { RENDER_JOB_STATUSES } from '@/lib/db/schema/index'

export const dynamic = 'force-dynamic'

/** 渲染任务列表：?status=&page=&pageSize=，附今日汇总。 */
export function GET(request: Request): Promise<Response> {
  return withAdminSession(async () => {
    const url = new URL(request.url)
    const statusParam = url.searchParams.get('status')
    const status = (RENDER_JOB_STATUSES as readonly string[]).includes(
      statusParam ?? '',
    )
      ? (statusParam as RenderJobStatus)
      : undefined
    const result = await listRenderJobs({
      status,
      page: readInt(url.searchParams.get('page'), 1),
      pageSize: readInt(url.searchParams.get('pageSize'), 20),
    })
    return NextResponse.json({ ok: true, ...result })
  }, { routeGroup: 'GET /api/admin/jobs' })
}

function readInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}
