import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import {
  assertNodeExecutionFence,
  type NodeExecutionFence,
} from '@/lib/db/transaction'
import { projects } from '@/lib/db/schema/index'
import {
  resumeProjectPipeline,
  type PipelineResumeResult,
} from './advance'

export interface AudioContinuationExecution {
  nodeId: string
  fence: NodeExecutionFence
}

/**
 * Audio 的 ASR 是独立入口。只有入口成功或用户显式重启时才开启续接门闩，
 * 然后复用 Director 的通用前沿恢复，不借用 script autopilot。
 */
export async function activateAudioDirectorContinuation(
  projectId: string,
  execution?: AudioContinuationExecution,
  dependencies: {
    database?: Db
    resume?: (projectId: string) => Promise<PipelineResumeResult>
  } = {},
): Promise<PipelineResumeResult> {
  await enableAudioDirectorContinuation(
    projectId,
    execution,
    dependencies.database,
  )
  return (dependencies.resume ?? resumeProjectPipeline)(projectId)
}

export async function enableAudioDirectorContinuation(
  projectId: string,
  execution?: AudioContinuationExecution,
  targetDatabase?: Db,
): Promise<void> {
  const database = targetDatabase ?? await getDb()
  const workspaceId = currentWorkspaceId()
  await database.transaction(async (transaction) => {
    const [project] = await transaction
      .select({
        id: projects.id,
        workflowKind: projects.workflowKind,
      })
      .from(projects)
      .where(and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
      ))
      .limit(1)
      .for('update')
    if (!project || project.workflowKind !== 'audio') {
      throw new Error('录音项目不存在或工作流类型不匹配')
    }
    if (execution) {
      await assertNodeExecutionFence(
        transaction,
        { id: execution.nodeId, projectId },
        execution.fence,
      )
    }
    await transaction
      .update(projects)
      .set({
        directorContinuationEnabled: true,
        updatedAt: sql`now()`,
      })
      .where(and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
        eq(projects.workflowKind, 'audio'),
      ))
  })
}
