import { NextResponse } from 'next/server'
import { withApiSession } from '@/features/auth/api-session'
import { exportSettingsSchema, updateExportSettings } from '@/features/canvas'
import {
  deleteProject,
  ProjectDeleteBlockedError,
  ProjectNotFoundError,
  ProjectTitleError,
  renameProject,
} from '@/features/projects'

export const dynamic = 'force-dynamic'

/**
 * 更新项目：body 含 `title` 走重命名，含 `exportSettings` 走导出设置。
 * 两者互斥且都缺时 400 且不写库；项目不存在 404。
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withApiSession(() => handlePatch(request, params))
}

/** 物理删除整个项目（不可恢复），口径见 docs/conventions/project-workflows.md。 */
export function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withApiSession(() => handleDelete(params))
}

async function handlePatch(request: Request, params: Promise<{ id: string }>) {
  const { id } = await params
  const body = await readJsonObject(request)
  if (body && 'title' in body) return patchTitle(id, body.title)
  return patchExportSettings(id, body?.exportSettings)
}

async function patchTitle(id: string, title: unknown) {
  try {
    const project = await renameProject(id, title)
    return NextResponse.json({ ok: true, project })
  } catch (error) {
    return mapProjectMutationError(error, '项目重命名失败')
  }
}

async function patchExportSettings(id: string, input: unknown) {
  const parsed = exportSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'exportSettings 无效' }, { status: 400 })
  }
  try {
    const exportSettings = await updateExportSettings(id, parsed.data)
    return NextResponse.json({ ok: true, exportSettings })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '导出设置更新失败' },
      { status: 404 }
    )
  }
}

async function handleDelete(params: Promise<{ id: string }>) {
  const { id } = await params
  try {
    const result = await deleteProject(id)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return mapProjectMutationError(error, '项目删除失败')
  }
}

/**
 * 领域错误 → HTTP；未知错误只给类别文案。
 * 未知错误必须落服务端日志：否则 UI 只能看到脱敏文案，无法取到失败真值。
 */
function mapProjectMutationError(error: unknown, fallback: string) {
  if (
    error instanceof ProjectTitleError ||
    error instanceof ProjectNotFoundError ||
    error instanceof ProjectDeleteBlockedError
  ) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.statusCode }
    )
  }
  console.error(
    `[projects/[id]] ${fallback}：${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`
  )
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 })
}

async function readJsonObject(
  request: Request
): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  return body as Record<string, unknown>
}
