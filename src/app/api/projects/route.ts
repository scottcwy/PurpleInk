import { NextResponse } from 'next/server'
import { createProject, getCanvasGraph, listProjects } from '@/features/canvas'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ projects: await listProjects() })
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null)
  try {
    const project = await createProject(body)
    const ingestNodeId = (await getCanvasGraph(project.id)).nodes.find(
      ({ type }) => type === 'script-import'
    )?.id
    if (!ingestNodeId) throw new Error('项目初始 INGEST 节点创建失败')
    return NextResponse.json({ ok: true, project, ingestNodeId }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '创建失败' },
      { status: 400 },
    )
  }
}
