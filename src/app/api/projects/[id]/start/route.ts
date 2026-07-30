import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiSession } from '@/features/auth/api-session'
import {
  QuotaExhaustedError,
} from '@/features/billing'
import { classifyWorkflowError } from '@/features/canvas'
import {
  ProjectExecutionStopError,
  ProjectWorkflowStartError,
  startProjectWorkflow,
  stopProjectExecution,
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
  return withApiSession(() => handlePost(context))
}

export function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withApiSession(() => handleDelete(context))
}

async function handlePost(context: RouteContext): Promise<Response> {
  const parsedId = await parseProjectId(context)
  if (!parsedId.success) return parsedId.response
  try {
    await initQueue()
    return NextResponse.json({
      ok: true,
      ...(await startProjectWorkflow(parsedId.projectId)),
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

async function handleDelete(context: RouteContext): Promise<Response> {
  const parsedId = await parseProjectId(context)
  if (!parsedId.success) return parsedId.response
  try {
    return NextResponse.json({
      ok: true,
      ...(await stopProjectExecution(parsedId.projectId)),
    })
  } catch (error) {
    if (error instanceof ProjectExecutionStopError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.statusCode },
      )
    }
    const projected = classifyWorkflowError(error, { stage: 'QUEUE' })
    return NextResponse.json(
      { ok: false, code: projected.code, error: projected.message },
      { status: 409 },
    )
  }
}

async function parseProjectId(context: RouteContext): Promise<
  | { success: true; projectId: string }
  | { success: false; response: NextResponse }
> {
  const parsedId = z.string().uuid().safeParse((await context.params).id)
  if (parsedId.success) {
    return { success: true, projectId: parsedId.data }
  }
  return {
    success: false,
    response: NextResponse.json(
      { ok: false, code: 'INVALID_PROJECT_ID', error: '项目 ID 无效' },
      { status: 400 },
    ),
  }
}
