import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { TransactionContext } from '@/lib/db/transaction'
import { and, eq, sql } from 'drizzle-orm'
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

/** 从已读取的 payload 中剔除指定 key（用于清理跨重试残留的失败标记）。 */
export function withoutPayloadKeys(
  payload: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const next = { ...payload }
  for (const key of keys) delete next[key]
  return next
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
        eq(canvasNodes.workspaceId, currentWorkspaceId()),
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
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(canvasNodes.workspaceId, currentWorkspaceId()),
        eq(canvasNodes.id, nodeId)
      )
    )
}
