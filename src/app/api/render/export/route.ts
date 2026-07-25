import { NextResponse } from 'next/server'
import { z } from 'zod'
import { enqueueProjectExport } from '@/features/render/export-queue-handler'
import {
  ensureShotQaChecked,
  getExportReadiness,
} from '@/features/render/export-service'
import { initQueue } from '@/lib/queue/init'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({ projectId: z.string().min(1) }).strict()

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ ok: false, error: '缺少 projectId' }, { status: 400 })
  }
  try {
    // best-effort：QA 检测失败（如缩略图截取异常）不阻断 readiness 返回。
    try {
      await ensureShotQaChecked(projectId)
    } catch (error) {
      console.error(
        `[render/export] QA 检测触发失败：${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    const { finalArtifactId, ...readiness } = await getExportReadiness(projectId)
    return NextResponse.json({
      ok: true,
      ...readiness,
      artifactUrl: finalArtifactId
        ? `/api/artifacts/${finalArtifactId}?projectId=${encodeURIComponent(projectId)}`
        : null,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '导出状态读取失败' },
      { status: 404 }
    )
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: '请求体无效' }, { status: 400 })
  }
  try {
    await initQueue()
    // 未就绪在入队前如实拒绝，保持既有 409 + incompleteNodeIds 契约；
    // 拼接与产物提交交给项目级队列作业（需要 project 级 attempt 才能提交 final-mp4）。
    const readiness = await getExportReadiness(parsed.data.projectId)
    if (!readiness.ready) {
      return NextResponse.json(
        { ok: false, incompleteNodeIds: readiness.incompleteNodeIds },
        { status: 409 }
      )
    }
    return NextResponse.json({
      ok: true,
      jobId: await enqueueProjectExport({ projectId: parsed.data.projectId }),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : '终片导出失败',
      },
      { status: 409 }
    )
  }
}
