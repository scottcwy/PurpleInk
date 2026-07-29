import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { cancelDeferredAttempt } from '@/lib/queue/cancel-deferred'
import { transitionNodeStatus } from '@/features/canvas/status'

export async function cancelProviderWaitAction(input: {
  projectId: string
  nodeId: string
}) {
  const attemptId = await cancelDeferredAttempt(await getDb(), {
    workspaceId: currentWorkspaceId(),
    ...input,
  })
  await transitionNodeStatus(input.nodeId, 'cancelled', { executionNotice: null })
  return {
    ok: true as const,
    action: 'cancel-wait' as const,
    requestedNodeId: input.nodeId,
    queuedNodeId: input.nodeId,
    jobId: attemptId,
    message: '已取消等待',
  }
}
