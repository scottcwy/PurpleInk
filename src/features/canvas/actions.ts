import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  canvasEdges,
  canvasNodes,
  projects,
} from '@/lib/db/schema/index'
import { withTransaction } from '@/lib/db/transaction'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import { DEFAULT_EXPORT_SETTINGS } from './export-settings'
import { createProjectSchema, exportSettingsSchema, type ExportSettings } from './schemas'
import type { Project } from './types'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'

const GLOBAL_NODE_DEFINITIONS = [
  { type: 'script-import', stage: 'INGEST', logicalKey: 'global:script-import' },
  { type: 'shot-split', stage: 'DIRECT', logicalKey: 'global:shot-split' },
  { type: 'score', stage: 'ASSEMBLE', logicalKey: 'global:score' },
  { type: 'export', stage: 'FINALIZE', logicalKey: 'global:export' },
] as const

/**
 * 单事务创建项目与初始全局 DAG，避免出现无入口节点的半成品项目。
 *
 * workspace 行的创建点唯一在注册事务（auth-repository 的
 * `createUserWithWorkspace`）；这里只消费当前会话的归属，不再 upsert
 * workspace（PLAN-002 §5.2）。
 */
export async function createProject(input: unknown): Promise<Project> {
  const { title, script, visualTheme } = createProjectSchema.parse(input)
  const workspaceId = currentWorkspaceId()
  const database = await getDb()
  return withTransaction(database, async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        workspaceId,
        id: randomUUID(),
        title,
        script,
        workflowKind: 'script',
        workflowVersion: activeWorkflowVersionFor('script'),
        exportSettings: {
          schemaVersion: 1,
          settings: DEFAULT_EXPORT_SETTINGS,
        },
      })
      .returning({
        id: projects.id,
        kind: projects.workflowKind,
        title: projects.title,
        script: projects.script,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
    if (!project) throw new Error('项目创建失败')

    const nodes = GLOBAL_NODE_DEFINITIONS.map((definition) => ({
      workspaceId,
      id: randomUUID(),
      projectId: project.id,
      ...definition,
      data: {
        schemaVersion: 1,
        payload:
          definition.type === 'script-import'
            ? { directorInput: { rawScript: script }, visualTheme }
            : {},
      },
    }))
    await tx.insert(canvasNodes).values(nodes)
    await tx
      .insert(canvasEdges)
      .values([
        {
          workspaceId,
          id: randomUUID(),
          projectId: project.id,
          source: nodes[0]!.id,
          target: nodes[1]!.id,
        },
        {
          workspaceId,
          id: randomUUID(),
          projectId: project.id,
          source: nodes[2]!.id,
          target: nodes[3]!.id,
        },
      ])
    return project
  })
}

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
