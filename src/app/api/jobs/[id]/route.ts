import { NextResponse } from 'next/server'
import { getLatestArtifact, type ArtifactDescriptor } from '@/features/artifacts'
import { withApiSession } from '@/features/auth/api-session'
import { getJobSnapshot, type JobSnapshot } from '@/lib/queue'

export const dynamic = 'force-dynamic'

/** 作业完成后可下载的产物：单镜作业挂节点聚合，项目级导出作业挂项目聚合。 */
async function completedArtifact(
  projectId: string,
  job: JobSnapshot
): Promise<ArtifactDescriptor | null> {
  if (job.status !== 'done') return null
  if (job.kind === 'render-shot' && job.nodeId) {
    return getLatestArtifact(projectId, job.nodeId, 'render-mp4')
  }
  if (job.kind === 'export-project') {
    return getLatestArtifact(projectId, null, 'final-mp4')
  }
  return null
}

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withApiSession(() => handleGet(request, params))
}

async function handleGet(request: Request, params: Promise<{ id: string }>) {
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ ok: false, error: '缺少 projectId' }, { status: 400 })
  }
  const job = await getJobSnapshot(projectId, (await params).id)
  if (!job) {
    return NextResponse.json({ ok: false, error: '作业不存在或不属于该项目' }, { status: 404 })
  }
  const artifact = await completedArtifact(projectId, job)
  return NextResponse.json({
    ok: true,
    job,
    artifactUrl: artifact
      ? `/api/artifacts/${artifact.id}?projectId=${encodeURIComponent(projectId)}`
      : null,
  })
}
