import type { WorkflowExecutionNotice } from '@/features/canvas/workflow-fault'
import { runInAuthContext, SYSTEM_USER_ID } from '@/lib/auth/workspace-context'

/**
 * 自动重试前把节点复位到 pending：handler 开场都走 pending -> running，
 * 而首次失败的补偿已把节点置 failed（failed -> running 非法）。复位失败只记日志，
 * 不阻断重试排队本身。
 */
export async function resetNodeForRetry(
  workspaceId: string,
  nodeId: string,
  notice?: WorkflowExecutionNotice,
): Promise<void> {
  try {
    const { transitionNodeStatus } = await import('@/features/canvas/status')
    await runInAuthContext({ workspaceId, userId: SYSTEM_USER_ID }, () =>
      transitionNodeStatus(
        nodeId,
        'pending',
        notice ? { executionNotice: notice } : undefined,
      ),
    )
  } catch (error) {
    console.error('[queue] 自动重试的节点复位失败', { nodeId, error })
  }
}
