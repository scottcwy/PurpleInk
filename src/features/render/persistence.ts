import type { TransactionContext } from '@/lib/db/transaction'
import { and, eq } from 'drizzle-orm'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { canvasNodes } from '@/lib/db/schema/index'

export function readPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const payload = (value as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {}
  }
  return payload as Record<string, unknown>
}

export function versionedPayload(payload: Record<string, unknown>): {
  schemaVersion: number
  payload: Record<string, unknown>
} {
  return { schemaVersion: 1, payload }
}

export function laneKeyOf(data: unknown): string | null {
  const laneKey = readPayload(data).laneKey
  return typeof laneKey === 'string' && laneKey.length > 0 ? laneKey : null
}

export function legacyNodeStatus(status: string): string {
  if (status === 'queued') return 'pending'
  if (status === 'succeeded') return 'success'
  return status
}

export async function writeNodeProjection(
  transaction: TransactionContext,
  nodeId: string,
  key: string,
  value: unknown
): Promise<void> {
  const [node] = await transaction
    .select({ data: canvasNodes.data })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
        eq(canvasNodes.id, nodeId)
      )
    )
    .limit(1)
    .for('update')
  if (!node) throw new Error(`节点不存在：${nodeId}`)
  await transaction
    .update(canvasNodes)
    .set({
      data: versionedPayload({ ...readPayload(node.data), [key]: value }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
        eq(canvasNodes.id, nodeId)
      )
    )
}
