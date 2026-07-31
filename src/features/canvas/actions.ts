import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { projects } from '@/lib/db/schema/index'
import {
  exportSettingsPatchSchema,
  mergeExportSettings,
  resolveExportSettings,
  type ExportSettings,
} from './export-settings'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'

/**
 * 局部更新项目导出设置（分辨率预设、字幕交付模式）。
 *
 * 读改写放在同一个事务里并对项目行加锁：这一列是整体覆盖写入的 jsonb，如果先读
 * 后写不加锁，两个并发的单字段 PATCH 会互相抹掉对方的字段。非法输入由 zod 抛错，
 * 不写库；项目不存在抛可读错误。返回已持久化的完整设置供调用方回显。
 *
 * 直接用 `database.transaction` 而不是 `@/lib/db/transaction` 的包装：后者的
 * 特化路径会给 features/canvas 增加一条新的 db 导入，而 verify:v3 的
 * canvasForbiddenImports 债务上限正是在盯这类耦合增长；这里也不存在它要划定的
 * 跨 repository 边界，只是单表读改写。
 */
export async function updateExportSettings(
  projectId: string,
  input: unknown
): Promise<ExportSettings> {
  const patch = exportSettingsPatchSchema.parse(input)
  await assertProjectWorkflowSupported(projectId)
  const database = await getDb()
  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .select({ exportSettings: projects.exportSettings })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, currentWorkspaceId()),
          eq(projects.id, projectId)
        )
      )
      .limit(1)
      .for('update')
    if (!row) throw new Error(`项目不存在：${projectId}`)
    const exportSettings = mergeExportSettings(
      resolveExportSettings(readSettings(row.exportSettings)),
      patch
    )
    await transaction
      .update(projects)
      .set({
        exportSettings: { schemaVersion: 1, settings: exportSettings },
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(projects.workspaceId, currentWorkspaceId()),
          eq(projects.id, projectId)
        )
      )
    return exportSettings
  })
}

function readSettings(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }
  return (payload as Record<string, unknown>).settings
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
    .set({ autopilot: enabled, updatedAt: sql`now()` })
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
