import { NextResponse } from 'next/server'
import { withApiSession } from '@/features/auth/api-session'
import { listProjects } from '@/features/canvas'
import {
  createProjectFromRequest,
  ProjectCreateInputError,
} from '@/features/projects'

export const dynamic = 'force-dynamic'

export function GET(): Promise<Response> {
  return withApiSession(async () =>
    NextResponse.json({ projects: await listProjects() }),
  )
}

export function POST(request: Request): Promise<Response> {
  return withApiSession(() => handlePost(request))
}

async function handlePost(request: Request) {
  try {
    const { project, entryNodeId } = await createProjectFromRequest(request)
    return NextResponse.json(
      {
        ok: true,
        project,
        entryNodeId,
        // 旧版文稿创建客户端仍读取该字段；统一启动入口接线后删除此兼容别名。
        ingestNodeId: entryNodeId,
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof ProjectCreateInputError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.statusCode },
      )
    }
    return NextResponse.json(
      { ok: false, error: '项目创建失败，请稍后重试', code: 'PROJECT_CREATE_FAILED' },
      { status: 500 },
    )
  }
}
