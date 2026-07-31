import { and, desc, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { pipelineRuns, taskAttempts } from '@/lib/db/schema'

export async function cancelDeferredAttempt(
  database: Db,
  input: { workspaceId: string; projectId: string; nodeId: string }
): Promise<string> {
  return database.transaction(async (transaction) => {
    const [attempt] = await transaction
      .select({
        id: taskAttempts.id,
        runId: taskAttempts.runId,
        checkpoint: taskAttempts.checkpoint,
      })
      .from(taskAttempts)
      .innerJoin(
        pipelineRuns,
        and(
          eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
          eq(pipelineRuns.id, taskAttempts.runId),
        )
      )
      .where(and(
        eq(taskAttempts.workspaceId, input.workspaceId),
        eq(taskAttempts.entityType, 'node'),
        eq(taskAttempts.entityId, input.nodeId),
        eq(taskAttempts.status, 'queued'),
        eq(pipelineRuns.projectId, input.projectId),
      ))
      .orderBy(desc(taskAttempts.attemptNo))
      .limit(1)
      .for('update', { of: taskAttempts })
    if (!attempt || !isProviderWait(attempt.checkpoint)) {
      throw new Error('当前节点没有可取消的限流等待任务')
    }
    await transaction
      .update(taskAttempts)
      .set({
        status: 'cancelled',
        failure: {
          schemaVersion: 2,
          code: 'TASK_INTERRUPTED',
          message: '用户已取消限流等待',
        },
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(
        eq(taskAttempts.workspaceId, input.workspaceId),
        eq(taskAttempts.id, attempt.id),
        eq(taskAttempts.status, 'queued'),
      ))
    await transaction
      .update(pipelineRuns)
      .set({
        status: 'cancelled',
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
        revision: sql`${pipelineRuns.revision} + 1`,
      })
      .where(and(
        eq(pipelineRuns.workspaceId, input.workspaceId),
        eq(pipelineRuns.id, attempt.runId),
      ))
    return attempt.id
  })
}

function isProviderWait(checkpoint: unknown): boolean {
  if (!checkpoint || typeof checkpoint !== 'object') return false
  const queueMeta = (checkpoint as Record<string, unknown>).queueMeta
  return Boolean(
    queueMeta
    && typeof queueMeta === 'object'
    && typeof (queueMeta as Record<string, unknown>).providerWaitStartedAt === 'string'
  )
}
