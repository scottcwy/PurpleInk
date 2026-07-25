import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCanvasGraph } from '@/features/canvas'
import { PIPELINE_STAGES } from '@/features/director'
import { enqueueDirectorStage } from '@/features/director/queue-handler'
import { initQueue } from '@/lib/queue/init'

export const dynamic = 'force-dynamic'

const requestSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    stage: z.enum(PIPELINE_STAGES),
  })
  .strict()

export async function POST(request: Request) {
  await initQueue()
  const body: unknown = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? '请求体无效' },
      { status: 400 }
    )
  }
  const graph = await getCanvasGraph(parsed.data.projectId)
  if (!graph.nodes.some((node) => node.id === parsed.data.nodeId)) {
    return NextResponse.json(
      { ok: false, error: '节点不存在或不属于该项目' },
      { status: 404 }
    )
  }
  try {
    const jobId = await enqueueDirectorStage(parsed.data)
    return NextResponse.json({ ok: true, jobId })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '作业入队失败' },
      { status: 409 }
    )
  }
}
