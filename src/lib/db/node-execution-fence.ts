import { and, eq, gt, isNull } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  pipelineRuns,
  projects,
  taskAttempts,
} from '@/lib/db/schema/index'
import type { TransactionContext } from '@/lib/db/transaction'

export interface NodeExecutionFence {
  projectId: string
  attemptId: string
  signal?: AbortSignal
}

/**
 * 在调用方事务内锁定 attempt，并确认它仍属于当前 execution epoch。
 * 这样等待数据库锁期间到达的取消信号也会让整个节点写入回滚。
 */
export async function assertNodeExecutionFence(
  tx: TransactionContext,
  node: { id: string; projectId: string },
  execution: NodeExecutionFence,
): Promise<void> {
  execution.signal?.throwIfAborted()
  if (node.projectId !== execution.projectId) throw new Error('STALE_ATTEMPT')
  const [attempt] = await tx
    .select({
      runId: taskAttempts.runId,
      taskId: taskAttempts.taskId,
      entityType: taskAttempts.entityType,
      entityId: taskAttempts.entityId,
      attemptNo: taskAttempts.attemptNo,
    })
    .from(taskAttempts)
    .innerJoin(
      pipelineRuns,
      and(
        eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
        eq(pipelineRuns.id, taskAttempts.runId),
      ),
    )
    .innerJoin(
      projects,
      and(
        eq(projects.workspaceId, pipelineRuns.workspaceId),
        eq(projects.id, pipelineRuns.projectId),
      ),
    )
    .where(
      and(
        eq(taskAttempts.workspaceId, currentWorkspaceId()),
        eq(taskAttempts.id, execution.attemptId),
        eq(taskAttempts.entityType, 'node'),
        eq(taskAttempts.entityId, node.id),
        eq(taskAttempts.status, 'running'),
        isNull(taskAttempts.cancelRequestedAt),
        eq(pipelineRuns.projectId, execution.projectId),
        eq(pipelineRuns.status, 'running'),
        eq(pipelineRuns.executionEpoch, projects.executionEpoch),
      ),
    )
    .limit(1)
    .for('update', { of: taskAttempts })
  execution.signal?.throwIfAborted()
  if (!attempt) throw new Error('STALE_ATTEMPT')
  const [newerAttempt] = await tx
    .select({ id: taskAttempts.id })
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.workspaceId, currentWorkspaceId()),
        eq(taskAttempts.runId, attempt.runId),
        eq(taskAttempts.taskId, attempt.taskId),
        eq(taskAttempts.entityType, attempt.entityType),
        eq(taskAttempts.entityId, attempt.entityId),
        gt(taskAttempts.attemptNo, attempt.attemptNo),
      ),
    )
    .limit(1)
    .for('update')
  execution.signal?.throwIfAborted()
  if (newerAttempt) throw new Error('STALE_ATTEMPT')
}
