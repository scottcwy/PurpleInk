import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { cancelDeferredAttempt } from '@/lib/queue/cancel-deferred'
import { transitionNodeStatus } from '@/features/canvas/status'
import { releaseTerminalWorkflowSlotForNode } from '@/features/ai/workspace-concurrency-release'

export async function cancelProviderWaitAction(input: {
  projectId: string
  nodeId: string
}) {
  const database = await getDb()
  const workspaceId = currentWorkspaceId()
  const attemptId = await cancelDeferredAttempt(database, {
    workspaceId,
    ...input,
  })
  await transitionNodeStatus(input.nodeId, 'cancelled', { executionNotice: null })
  await releaseTerminalWorkflowSlotForNode({
    workspaceId,
    nodeId: input.nodeId,
    database,
  })
  return {
    ok: true as const,
    action: 'cancel-wait' as const,
    requestedNodeId: input.nodeId,
    queuedNodeId: input.nodeId,
    jobId: attemptId,
    message: '已取消等待',
  }
}
