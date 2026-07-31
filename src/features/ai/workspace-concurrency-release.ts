import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { canvasNodes, workflowConcurrencyLeases } from '@/lib/db/schema'

export async function releaseWorkflowSlot(input: {
  workspaceId: string
  projectId: string
  workUnitKey: string
  outcome: 'released' | 'cancelled'
  database: Db
  now?: Date
}): Promise<void> {
  const now = input.now ?? sql`now()`
  await input.database
    .update(workflowConcurrencyLeases)
    .set({
      status: input.outcome,
      releasedAt: now,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
      eq(workflowConcurrencyLeases.projectId, input.projectId),
      eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
    ))
}

/** 节点终态后释放整条分镜租约；普通阶段成功不会提前释放。 */
export async function releaseTerminalWorkflowSlotForNode(input: {
  workspaceId: string
  nodeId: string
  database: Db
}): Promise<void> {
  const [node] = await input.database
    .select({
      projectId: canvasNodes.projectId,
      type: canvasNodes.type,
      status: canvasNodes.status,
      data: canvasNodes.data,
    })
    .from(canvasNodes)
    .where(and(
      eq(canvasNodes.workspaceId, input.workspaceId),
      eq(canvasNodes.id, input.nodeId),
    ))
    .limit(1)
  const laneKey = readLaneKey(node?.data)
  if (!node || !laneKey) return
  const terminal = node.status === 'failed'
    || node.status === 'cancelled'
    || node.status === 'skipped'
    || (node.type === 'shot-qa' && node.status === 'succeeded')
  if (!terminal) return
  await releaseWorkflowSlot({
    workspaceId: input.workspaceId,
    projectId: node.projectId,
    workUnitKey: laneKey,
    outcome: node.status === 'cancelled' ? 'cancelled' : 'released',
    database: input.database,
  })
}

function readLaneKey(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = (value as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const laneKey = (payload as Record<string, unknown>).laneKey
  return typeof laneKey === 'string' && laneKey.length > 0 ? laneKey : null
}
