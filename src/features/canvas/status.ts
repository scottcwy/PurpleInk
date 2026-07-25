import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { canvasEdges, canvasNodes } from '@/lib/db/schema/index'
import {
  withTransaction,
  type TransactionContext,
} from '@/lib/db/transaction'
import type { NodeStatus } from './types'

export type { NodeStatus } from './types'

const ALLOWED_TRANSITIONS: Record<NodeStatus, readonly NodeStatus[]> = {
  idle: ['pending'],
  pending: ['running', 'cancelled'],
  running: ['success', 'failed', 'cancelled'],
  success: ['stale'],
  failed: ['pending', 'stale'],
  cancelled: ['pending', 'stale'],
  stale: ['pending'],
}

/** 对 JSON 可序列化输入生成跨进程稳定的 SHA-256。 */
export function computeContentHash(input: unknown): string {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) throw new Error('内容哈希输入必须可 JSON 序列化')

  let normalized: unknown
  try {
    normalized = sortJsonValue(JSON.parse(serialized) as unknown)
  } catch (error) {
    throw new Error('内容哈希输入必须可 JSON 序列化', { cause: error })
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

/** 原子校验并写入节点状态；stale 只允许由真实上游变化触发。 */
export async function transitionNodeStatus(
  nodeId: string,
  next: NodeStatus
): Promise<void> {
  const database = await getDb()
  await withTransaction(database, async (tx) => {
    const [node] = await tx
      .select({
        id: canvasNodes.id,
        status: canvasNodes.status,
        data: canvasNodes.data,
      })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )
      .for('update')
    if (!node) throw new Error(`节点不存在：${nodeId}`)
    const current = fromPersistedStatus(node.status)
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new Error(`非法节点状态转换：${current} -> ${next}`)
    }
    if (next === 'stale' && !(await isStaleInTransaction(tx, node))) {
      throw new Error(`节点上游内容未变化，不能标记为 stale：${nodeId}`)
    }
    await tx
      .update(canvasNodes)
      .set({ status: toPersistedStatus(next), updatedAt: new Date() })
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )
  })
}

/**
 * 比较节点保存的“上次消费依赖指纹”与当前全部上游节点哈希。
 * 无上游的根节点不由依赖变化触发 stale。
 */
export async function isStale(nodeId: string): Promise<boolean> {
  const database = await getDb()
  return withTransaction(database, async (tx) => {
    const [node] = await tx
      .select({ id: canvasNodes.id, data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )
    if (!node) throw new Error(`节点不存在：${nodeId}`)
    return isStaleInTransaction(tx, node)
  })
}

async function isStaleInTransaction(
  tx: TransactionContext,
  node: { id: string; data: unknown }
): Promise<boolean> {
  const dependencies = await dependencyHashes(tx, node.id)
  if (dependencies.length === 0) return false
  return readContentHash(node.data) !== computeContentHash(dependencies)
}

async function dependencyHashes(
  tx: TransactionContext,
  nodeId: string
): Promise<Array<{ id: string; contentHash: string | null }>> {
  const incoming = await tx
    .select({ source: canvasEdges.source })
    .from(canvasEdges)
    .where(
      and(
        eq(canvasEdges.workspaceId, LOCAL_WORKSPACE_ID),
        eq(canvasEdges.target, nodeId)
      )
    )
  if (incoming.length === 0) return []

  const nodes = await tx
    .select({ id: canvasNodes.id, data: canvasNodes.data })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
        inArray(
          canvasNodes.id,
          incoming.map(({ source }) => source)
        )
      )
    )
  return nodes
    .map((node) => ({
      id: node.id,
      contentHash: readContentHash(node.data),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function readContentHash(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = (value as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const contentHash = (payload as Record<string, unknown>).contentHash
  return typeof contentHash === 'string' ? contentHash : null
}

function toPersistedStatus(status: NodeStatus): string {
  if (status === 'pending') return 'queued'
  if (status === 'success') return 'succeeded'
  return status
}

function fromPersistedStatus(status: string): NodeStatus {
  if (status === 'queued') return 'pending'
  if (status === 'succeeded') return 'success'
  if (
    status === 'idle' ||
    status === 'running' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'stale'
  ) {
    return status
  }
  throw new Error(`未知节点状态：${status}`)
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonValue(child)])
    )
  }
  return value
}
