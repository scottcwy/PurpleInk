import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiSession } from '@/features/auth/api-session'
import { classifyWorkflowError } from '@/features/canvas'
import { executeNodeAction, skipNodeAction } from '@/features/director'
import {
  SKIP_REASON_MAX_LENGTH,
  SKIP_REASON_MIN_LENGTH,
} from '@/features/director/skip-policy'
import { initQueue } from '@/lib/queue/init'

export const dynamic = 'force-dynamic'

const requestSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    intent: z.enum(['execute', 'repair', 'regenerate', 'skip']),
    skipReason: z
      .string()
      .trim()
      .min(SKIP_REASON_MIN_LENGTH)
      .max(SKIP_REASON_MAX_LENGTH)
      .optional(),
  })
  .strict()
  // skip 是携带用户决策的写操作，原因必填（1-200 字）；其余 intent 不接受该字段。
  .refine((data) => data.intent !== 'skip' || data.skipReason !== undefined, {
    message: '跳过时必须填写原因（1-200 字）',
  })
  .refine((data) => data.intent === 'skip' || data.skipReason === undefined, {
    message: '仅 intent=skip 允许携带 skipReason',
  })

export function POST(request: Request): Promise<Response> {
  return withApiSession(() => handlePost(request))
}

async function handlePost(request: Request) {
  await initQueue()
  const body: unknown = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? '请求体无效' },
      { status: 400 }
    )
  }
  const { projectId, nodeId, intent, skipReason } = parsed.data
  try {
    if (intent === 'skip') {
      return NextResponse.json(
        await skipNodeAction({ projectId, nodeId, reason: skipReason! })
      )
    }
    return NextResponse.json(
      await executeNodeAction({ projectId, nodeId, intent })
    )
  } catch (error) {
    // 跳过被业务规则拒绝属于「请求语义不可满足」而非状态冲突：422，只回类别文案。
    if (error instanceof Error && error.name === 'SkipRejectedError') {
      return NextResponse.json(
        { ok: false, error: error.message, code: 'SKIP_REJECTED' },
        { status: 422 }
      )
    }
    const projected = classifyWorkflowError(error, { stage: 'QUEUE' })
    return NextResponse.json(
      { ok: false, error: projected.message, code: projected.code },
      { status: 409 }
    )
  }
}
