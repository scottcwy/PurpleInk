import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCanvasGraph } from '@/features/canvas'
import { initQueue } from '@/lib/queue/init'
import { enqueueRenderShot } from '@/features/render/queue-handler'

export const dynamic = 'force-dynamic'

const requestSchema = z
  .object({ projectId: z.string().min(1), nodeId: z.string().min(1) })
  .strict()

export async function POST(request: Request) {
  await initQueue()
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: '请求体无效' }, { status: 400 })
  }
  const { projectId, nodeId } = parsed.data
  const graph = await getCanvasGraph(projectId)
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    return NextResponse.json(
      { ok: false, error: '节点不存在或不属于该项目' },
      { status: 404 }
    )
  }
  try {
    return NextResponse.json({
      ok: true,
      jobId: await enqueueRenderShot({ projectId, nodeId }),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: messageOf(error) },
      { status: 409 }
    )
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '渲染作业入队失败'
}
