import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiSession } from '@/features/auth/api-session'
import { classifyWorkflowError } from '@/features/canvas'
import { executeNodeAction } from '@/features/director'
import { initQueue } from '@/lib/queue/init'

export const dynamic = 'force-dynamic'

const requestSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    intent: z.enum(['execute', 'repair', 'rerender']),
  })
  .strict()

export function POST(request: Request): Promise<Response> {
  return withApiSession(() => handlePost(request))
}

async function handlePost(request: Request) {
  await initQueue()
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: '请求体无效' }, { status: 400 })
  }
  try {
    return NextResponse.json(await executeNodeAction(parsed.data))
  } catch (error) {
    const projected = classifyWorkflowError(error, { stage: 'QUEUE' })
    return NextResponse.json(
      { ok: false, error: projected.message, code: projected.code },
      { status: 409 }
    )
  }
}
