import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiSession } from '@/features/auth/api-session'
import {
  getProjectExecutionSnapshot,
  ProjectExecutionSnapshotError,
} from '@/features/projects'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withApiSession(() => handleGet(context))
}

async function handleGet(context: RouteContext): Promise<Response> {
  const parsed = z.string().uuid().safeParse((await context.params).id)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_PROJECT_ID', error: '项目 ID 无效' },
      { status: 400 },
    )
  }
  try {
    return NextResponse.json({
      ok: true,
      execution: await getProjectExecutionSnapshot(parsed.data),
    })
  } catch (error) {
    if (error instanceof ProjectExecutionSnapshotError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.statusCode },
      )
    }
    return NextResponse.json(
      {
        ok: false,
        code: 'PROJECT_EXECUTION_UNAVAILABLE',
        error: '暂时无法读取项目执行状态',
      },
      { status: 503 },
    )
  }
}
