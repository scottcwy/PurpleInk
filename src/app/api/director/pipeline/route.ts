import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiSession } from '@/features/auth/api-session'
import {
  assertBillingAvailable,
  QuotaExhaustedError,
} from '@/features/billing'
import { classifyWorkflowError } from '@/features/canvas'
import {
  startProjectPipeline,
  stopProjectPipeline,
} from '@/features/director/advance'
import { initQueue } from '@/lib/queue/init'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({ projectId: z.string().min(1) }).strict()

export function POST(request: Request): Promise<Response> {
  return withApiSession(() => handlePost(request))
}

async function handlePost(request: Request) {
  const parsed = await parseRequest(request)
  if (!parsed.success) return parsed.response
  try {
    await assertBillingAvailable()
    await initQueue()
    const result = await startProjectPipeline(parsed.projectId)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof QuotaExhaustedError) {
      return NextResponse.json(
        {
          code: error.code,
          resetAt: error.resetAt,
          billingUrl: error.billingUrl,
        },
        { status: 402 },
      )
    }
    const projected = classifyWorkflowError(error, { stage: 'QUEUE' })
    return NextResponse.json(
      {
        ok: false,
        error: projected.message,
        code: projected.code,
      },
      { status: 409 }
    )
  }
}

export function DELETE(request: Request): Promise<Response> {
  return withApiSession(() => handleDelete(request))
}

async function handleDelete(request: Request) {
  const parsed = await parseRequest(request)
  if (!parsed.success) return parsed.response
  try {
    return NextResponse.json({
      ok: true,
      ...(await stopProjectPipeline(parsed.projectId)),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : '工作流停止失败',
      },
      { status: 404 }
    )
  }
}

async function parseRequest(
  request: Request
): Promise<
  | { success: true; projectId: string }
  | { success: false; response: NextResponse }
> {
  const body: unknown = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (parsed.success) return { success: true, projectId: parsed.data.projectId }
  return {
    success: false,
    response: NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? '请求体无效',
      },
      { status: 400 }
    ),
  }
}
