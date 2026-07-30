import { NextResponse } from 'next/server'
import { withApiSession } from '@/features/auth/api-session'
import { listProjects } from '@/features/canvas'
import {
  createProjectFromRequest,
  listProjectCardPage,
  PROJECT_CARD_PAGE_LIMIT,
  ProjectCreateInputError,
  type ProjectCardQuery,
} from '@/features/projects'
import { isProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Promise<Response> {
  return withApiSession(async () => {
    const params = new URL(request.url).searchParams
    if (params.get('view') !== 'cards') {
      // 无参数形状保持不变，既有客户端继续可用。
      return NextResponse.json({ projects: await listProjects() })
    }
    const query = parseCardQuery(params)
    if (!query) {
      return NextResponse.json(
        { ok: false, error: '分页参数无效', code: 'PROJECT_CARDS_BAD_QUERY' },
        { status: 400 },
      )
    }
    return NextResponse.json(await listProjectCardPage(query))
  }, { routeGroup: 'GET /api/projects' })
}

/** 只做参数解析与钳位；投影与 SQL 全部在 feature 层。 */
function parseCardQuery(params: URLSearchParams): ProjectCardQuery | null {
  const rawKind = params.get('kind') || null
  if (rawKind !== null && !isProjectWorkflowKind(rawKind)) return null
  const offset = parseBoundedInt(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = parseBoundedInt(params.get('limit'), 12, 1, PROJECT_CARD_PAGE_LIMIT)
  if (offset === null || limit === null) return null
  const q = params.get('q')?.trim().slice(0, 200) || undefined
  return { kind: rawKind ?? undefined, q, offset, limit }
}

function parseBoundedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (raw === null || raw === '') return fallback
  if (!/^\d+$/u.test(raw)) return null
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value)) return null
  return Math.min(Math.max(value, min), max)
}

export function POST(request: Request): Promise<Response> {
  return withApiSession(() => handlePost(request), { routeGroup: 'POST /api/projects' })
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
