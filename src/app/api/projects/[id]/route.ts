import { NextResponse } from 'next/server'
import { exportSettingsSchema, updateExportSettings } from '@/features/canvas'

export const dynamic = 'force-dynamic'

/** 更新项目导出设置（当前仅分辨率预设）。非法预设→400 且不写库；项目不存在→404。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body: unknown = await request.json().catch(() => null)
  const exportSettingsInput =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).exportSettings
      : undefined
  const parsed = exportSettingsSchema.safeParse(exportSettingsInput)
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
