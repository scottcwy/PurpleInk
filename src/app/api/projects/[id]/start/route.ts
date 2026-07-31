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
  getProjectExecutionSnapshot,
  recoverWebsiteDelivery,
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
    const current = await getProjectExecutionSnapshot(parsedId.projectId)
    if (
      current.active
      && current.attempt
      && (current.attempt.status === 'queued' || current.attempt.status === 'running')
    ) {
      await initQueue()
      return NextResponse.json({
        ok: true,
        kind: current.workflowKind,
        status: 'reused',
        jobId: current.attempt.id,
        attemptStatus: current.attempt.status,
        execution: current,
      })
    }
    if (current.workflowKind === 'website' && current.state === 'succeeded') {
      return NextResponse.json({
        ok: true,
        kind: 'website',
        status: 'complete',
        execution: current,
      })
    }
    if (current.workflowKind === 'website' && current.state === 'blocked') {
      const recovered = await recoverWebsiteDelivery(parsedId.projectId)
      if (recovered) {
        const execution = await getProjectExecutionSnapshot(parsedId.projectId)
        if (execution.state === 'succeeded') {
          return NextResponse.json({
            ok: true,
            kind: 'website',
            status: 'complete',
            execution,
          })
        }
      }
    }
    await initQueue()
    const started = await startProjectWorkflow(parsedId.projectId)
    const execution = await getProjectExecutionSnapshot(parsedId.projectId)
    return NextResponse.json({
      ok: true,
      ...started,
      status: started.kind === 'website'
        ? websiteStartStatus(execution.state, started.reused)
        : started.status,
      execution,
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
    const stopped = await stopProjectExecution(parsedId.projectId)
    return NextResponse.json({
      ok: true,
      ...stopped,
      execution: await getProjectExecutionSnapshot(parsedId.projectId),
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

function websiteStartStatus(
  state: Awaited<ReturnType<typeof getProjectExecutionSnapshot>>['state'],
  reused: boolean,
): 'started' | 'reused' | 'complete' | 'blocked' {
  if (state === 'succeeded') return 'complete'
  if (state === 'blocked') return 'blocked'
  return reused ? 'reused' : 'started'
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
