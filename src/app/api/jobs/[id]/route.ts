import { NextResponse } from 'next/server'
import { getLatestArtifact } from '@/features/artifacts'
import { getJobSnapshot } from '@/lib/queue'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ ok: false, error: '缺少 projectId' }, { status: 400 })
  }
  const job = await getJobSnapshot(projectId, (await params).id)
  if (!job) {
    return NextResponse.json({ ok: false, error: '作业不存在或不属于该项目' }, { status: 404 })
  }
  const artifact =
    job.status === 'done' && job.kind === 'render-shot' && job.nodeId
      ? await getLatestArtifact(projectId, job.nodeId, 'render-mp4')
      : null
  return NextResponse.json({
    ok: true,
    job,
    artifactUrl: artifact
      ? `/api/artifacts/${artifact.id}?projectId=${encodeURIComponent(projectId)}`
      : null,
  })
}
