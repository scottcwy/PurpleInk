import { NextResponse } from 'next/server'
import { withApiSession } from '@/features/auth/api-session'
import {
  getAiUsageProjection,
  type AiUsageRange,
  type AiUsageView,
} from '@/features/usage'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return withApiSession((session) => handleGet(request, session.userId))
}

async function handleGet(request: Request, userId: string): Promise<Response> {
  const params = new URL(request.url).searchParams
  const view = params.get('view')
  const range = params.get('range')
  const timeZone = params.get('timeZone')
  if (!isView(view) || !isRange(range) || !timeZone) {
    return invalidRequest('view、range 与 timeZone 必填且必须使用受支持的值')
  }
  if (
    (view === 'account' && range === 'cycle')
    || (view === 'managed-cycle' && range !== 'cycle')
  ) {
    return invalidRequest('account 仅支持 7d/30d，managed-cycle 仅支持 cycle')
  }
  if (!isTimeZone(timeZone)) return invalidRequest('timeZone 必须是合法 IANA 时区')
  const projection = await getAiUsageProjection({
    userId,
    view,
    range,
    timeZone,
  })
  return NextResponse.json(projection)
}

function isView(value: string | null): value is AiUsageView {
  return value === 'account' || value === 'managed-cycle'
}

function isRange(value: string | null): value is AiUsageRange {
  return value === '7d' || value === '30d' || value === 'cycle'
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function invalidRequest(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 400 })
}
