import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiSession } from '@/features/auth/api-session'
import {
  QuotaExhaustedError,
} from '@/features/billing'
import { classifyWorkflowError } from '@/features/canvas'
import {
  ProjectWorkflowStartError,
  startProjectWorkflow,
} from '@/features/projects'
import { initQueue } from '@/lib/queue/init'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withApiSession(() => handlePost(context), { routeGroup: 'POST /api/projects/:id/start' })
}

async function handlePost(context: RouteContext): Promise<Response> {
  const parsedId = z.string().uuid().safeParse((await context.params).id)
  if (!parsedId.success) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_PROJECT_ID', error: '项目 ID 无效' },
      { status: 400 },
    )
  }
  try {
    await initQueue()
    return NextResponse.json({
      ok: true,
      ...(await startProjectWorkflow(parsedId.data)),
    })
  } catch (error) {
    if (error instanceof QuotaExhaustedError) {
      return NextResponse.json(
        {
          ok: false,
          code: error.code,
          resetAt: error.resetAt,
          billingUrl: error.billingUrl,
        },
        { status: 402 },
      )
    }
    if (error instanceof ProjectWorkflowStartError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.statusCode },
      )
    }
    const projected = classifyWorkflowError(error, { stage: 'QUEUE' })
    return NextResponse.json(
      {
        ok: false,
        code: projected.code,
        error: projected.message,
      },
      { status: 409 },
    )
  }
}
