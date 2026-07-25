import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ensureShotQaChecked,
  exportProject,
  getExportReadiness,
} from '@/features/render/export-service'

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
    const result = await exportProject(parsed.data.projectId)
    if (!result.ok) return NextResponse.json(result, { status: 409 })
    return NextResponse.json({
      ok: true,
      contentHash: result.contentHash,
      artifactUrl: `/api/artifacts/${result.artifactId}?projectId=${encodeURIComponent(parsed.data.projectId)}`,
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
