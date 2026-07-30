import 'server-only'
import { and, eq } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { projects } from '@/lib/db/schema/index'
import { exportSettingsSchema, type ExportSettings } from './export-settings'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'

/**
 * 更新项目导出设置（当前仅分辨率预设）。非法输入由 zod 抛错，不写库；
 * 项目不存在抛可读错误。返回已持久化的设置供调用方回显。
 */
export async function updateExportSettings(
  projectId: string,
  input: unknown
): Promise<ExportSettings> {
  const exportSettings = exportSettingsSchema.parse(input)
  await assertProjectWorkflowSupported(projectId)
  const database = await getDb()
  const [updated] = await database
    .update(projects)
    .set({
      exportSettings: { schemaVersion: 1, settings: exportSettings },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projects.workspaceId, currentWorkspaceId()),
        eq(projects.id, projectId)
      )
    )
    .returning({ id: projects.id })
  if (!updated) throw new Error(`项目不存在：${projectId}`)
  return exportSettings
}

/** 开启或关闭项目级自动推进；项目不存在时不静默创建状态。 */
export async function setProjectAutopilot(
  projectId: string,
  enabled: boolean
): Promise<boolean> {
  await assertProjectWorkflowSupported(projectId)
  const database = await getDb()
  const [updated] = await database
    .update(projects)
    .set({ autopilot: enabled, updatedAt: new Date() })
    .where(
      and(
        eq(projects.workspaceId, currentWorkspaceId()),
        eq(projects.id, projectId)
      )
    )
    .returning({ autopilot: projects.autopilot })
  if (!updated) throw new Error(`项目不存在：${projectId}`)
  return updated.autopilot
}
