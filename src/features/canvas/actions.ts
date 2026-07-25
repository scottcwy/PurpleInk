import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  canvasEdges,
  canvasNodes,
  projects,
  workspaces,
} from '@/lib/db/schema/index'
import { withTransaction } from '@/lib/db/transaction'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from '@/lib/workflow/version'
import { DEFAULT_EXPORT_SETTINGS } from './export-settings'
import { createProjectSchema, exportSettingsSchema, type ExportSettings } from './schemas'
import type { Project } from './types'

const GLOBAL_NODE_DEFINITIONS = [
  { type: 'script-import', stage: 'INGEST', logicalKey: 'global:script-import' },
  { type: 'shot-split', stage: 'DIRECT', logicalKey: 'global:shot-split' },
  { type: 'score', stage: 'ASSEMBLE', logicalKey: 'global:score' },
  { type: 'export', stage: 'FINALIZE', logicalKey: 'global:export' },
] as const

/** 单事务创建项目与初始全局 DAG，避免出现无入口节点的半成品项目。 */
export async function createProject(input: unknown): Promise<Project> {
  const { title, script } = createProjectSchema.parse(input)
  const database = await getDb()
  return withTransaction(database, async (tx) => {
    await tx
      .insert(workspaces)
      .values({
        id: LOCAL_WORKSPACE_ID,
        slug: 'local',
        name: 'Local Workspace',
      })
      .onConflictDoNothing()
    const [project] = await tx
      .insert(projects)
      .values({
        workspaceId: LOCAL_WORKSPACE_ID,
        id: randomUUID(),
        title,
        script,
        workflowVersion: serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION),
        exportSettings: {
          schemaVersion: 1,
          settings: DEFAULT_EXPORT_SETTINGS,
        },
      })
      .returning({
        id: projects.id,
        title: projects.title,
        script: projects.script,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
    if (!project) throw new Error('项目创建失败')

    const nodes = GLOBAL_NODE_DEFINITIONS.map((definition, index) => ({
      workspaceId: LOCAL_WORKSPACE_ID,
      id: randomUUID(),
      projectId: project.id,
      ...definition,
      positionX: index * 260,
      positionY: 80,
      data: {
        schemaVersion: 1,
        payload:
          definition.type === 'script-import'
            ? { directorInput: { rawScript: script } }
            : {},
      },
    }))
    await tx.insert(canvasNodes).values(nodes)
    await tx
      .insert(canvasEdges)
      .values([
        {
          workspaceId: LOCAL_WORKSPACE_ID,
          id: randomUUID(),
          projectId: project.id,
          source: nodes[0]!.id,
          target: nodes[1]!.id,
        },
        {
          workspaceId: LOCAL_WORKSPACE_ID,
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
  const database = await getDb()
  const [updated] = await database
    .update(projects)
    .set({
      exportSettings: { schemaVersion: 1, settings: exportSettings },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projects.workspaceId, LOCAL_WORKSPACE_ID),
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
  const database = await getDb()
  const [updated] = await database
    .update(projects)
    .set({ autopilot: enabled, updatedAt: new Date() })
    .where(
      and(
        eq(projects.workspaceId, LOCAL_WORKSPACE_ID),
        eq(projects.id, projectId)
      )
    )
    .returning({ autopilot: projects.autopilot })
  if (!updated) throw new Error(`项目不存在：${projectId}`)
  return updated.autopilot
}
