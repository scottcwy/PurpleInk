import 'server-only'
import { and, eq } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import {
  assertNodeExecutionFence,
  type NodeExecutionFence,
} from '@/lib/db/transaction'
import { projects } from '@/lib/db/schema/index'
import type { PipelineResumeResult } from './advance'

export interface PipelineResumeExecution {
  nodeId: string
  fence: NodeExecutionFence
}

/**
 * 与 stop 共用 projects 行锁：先二次读取来源专属门闩，再在锁内完成前沿入队。
 * 若 stop 先提交则拒绝续接；若续接先持锁，stop 会在其后取消刚入队的当前代次。
 */
export async function withProjectResumeControl<T>(
  projectId: string,
  execution: PipelineResumeExecution | undefined,
  operation: () => Promise<T>,
  targetDatabase?: Db,
): Promise<T | null> {
  const database = targetDatabase ?? await getDb()
  const workspaceId = currentWorkspaceId()
  return database.transaction(async (transaction) => {
    execution?.fence.signal?.throwIfAborted()
    const [project] = await transaction
      .select({
        workflowKind: projects.workflowKind,
        autopilot: projects.autopilot,
        directorContinuationEnabled: projects.directorContinuationEnabled,
      })
      .from(projects)
      .where(and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
      ))
      .limit(1)
      .for('update')
    if (!project || !['script', 'audio'].includes(project.workflowKind)) {
      throw new Error('项目不存在或不支持 Director 自动推进')
    }
    const enabled = project.workflowKind === 'script'
      ? project.autopilot
      : project.directorContinuationEnabled
    if (!enabled) return null
    if (execution) {
      await assertNodeExecutionFence(
        transaction,
        { id: execution.nodeId, projectId },
        execution.fence,
      )
    }
    return operation()
  })
}

export function automaticAdvanceDisabled(
  projectId: string,
): PipelineResumeResult {
  return {
    status: 'blocked',
    enqueuedNodeIds: [],
    repairRootNodeIds: [],
    failedNodeIds: [],
    blockedNodes: [{
      nodeId: projectId,
      code: 'AUTOMATIC_ADVANCE_DISABLED',
      message: '项目自动推进已停止',
    }],
  }
}
