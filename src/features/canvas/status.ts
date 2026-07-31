import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  canvasEdges,
  canvasNodes,
} from '@/lib/db/schema/index'
import {
  assertNodeExecutionFence,
  withTransaction,
  type NodeExecutionFence,
  type TransactionContext,
} from '@/lib/db/transaction'
import { statusBus } from '@/lib/stream/status-bus'
import {
  computeContentHash,
  readInputFingerprint,
  readOutputContentHash,
} from './content-hash'
import type { WorkflowBlock, WorkflowExecutionNotice } from './workflow-fault'
import {
  fromPersistedStatus,
  patchPayload,
  resolveTransitionData,
  toPersistedStatus,
} from './status-payload'
import type { NodeStatus } from './types'

export type { NodeStatus } from './types'
export { computeContentHash } from './content-hash'

const ALLOWED_TRANSITIONS: Record<NodeStatus, readonly NodeStatus[]> = {
  idle: ['pending', 'blocked'],
  pending: ['running', 'cancelled'],
  running: ['success', 'failed', 'cancelled'],
  success: ['stale'],
  failed: ['pending', 'stale', 'skipped', 'blocked'],
  cancelled: ['pending', 'stale', 'skipped'],
  stale: ['pending', 'skipped', 'blocked'],
  skipped: ['pending'],
  blocked: ['pending'],
}

export function isNodeStatusTransitionAllowed(
  current: NodeStatus,
  next: NodeStatus,
): boolean {
  return ALLOWED_TRANSITIONS[current].includes(next)
}

export interface SkipMeta {
  reason: string
  at: string
  kind?: string
}

/** 原子校验并写入节点状态；stale 只允许由真实上游变化触发。 */
export async function transitionNodeStatus(
  nodeId: string,
  next: NodeStatus,
  options?: {
    skipMeta?: SkipMeta
    executionNotice?: WorkflowExecutionNotice | null
    workflowBlock?: WorkflowBlock
    execution?: NodeExecutionFence
    idempotent?: boolean
  }
): Promise<void> {
  options?.execution?.signal?.throwIfAborted()
  const database = await getDb()
  const projectId = await withTransaction(database, async (tx) => {
    const [node] = await tx
      .select({
        id: canvasNodes.id,
        projectId: canvasNodes.projectId,
        status: canvasNodes.status,
        data: canvasNodes.data,
      })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId)
        )
      )
      .for('update')
    if (!node) throw new Error(`节点不存在：${nodeId}`)
    if (options?.execution) {
      await assertNodeExecutionFence(tx, node, options.execution)
    }
    const current = fromPersistedStatus(node.status)
    if (options?.idempotent === true && current === next) return null
    const providerWaitTransition =
      current === 'running'
      && next === 'pending'
      && options?.executionNotice !== undefined
      && options.executionNotice !== null
    if (
      !isNodeStatusTransitionAllowed(current, next)
      && !providerWaitTransition
    ) {
      throw new Error(`非法节点状态转换：${current} -> ${next}`)
    }
    if (next === 'stale' && !(await isStaleInTransaction(tx, node))) {
      throw new Error(`节点上游内容未变化，不能标记为 stale：${nodeId}`)
    }
    const nextData = resolveTransitionData(
      node.data,
      current,
      next,
      options?.skipMeta,
      options?.executionNotice,
      options?.workflowBlock,
    )
    await tx
      .update(canvasNodes)
      .set({
        status: toPersistedStatus(next),
        ...(nextData === null ? {} : { data: nextData }),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId)
        )
      )
    options?.execution?.signal?.throwIfAborted()
    return node.projectId
  })
  // 严格在事务提交之后发布（回滚路径零事件）；发布失败不影响状态迁移。
  if (projectId !== null) {
    try {
      statusBus.publishStatus(projectId, nodeId, next)
    } catch {
      // 推送是体验增强，不反向阻断状态机。
    }
  }
}

export async function assertNodeExecutionActive(
  nodeId: string,
  execution: NodeExecutionFence,
): Promise<void> {
  execution.signal?.throwIfAborted()
  const database = await getDb()
  await withTransaction(database, async (tx) => {
    const [node] = await tx
      .select({
        id: canvasNodes.id,
        projectId: canvasNodes.projectId,
      })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId),
        ),
      )
      .limit(1)
      .for('update')
    if (!node) throw new Error(`节点不存在：${nodeId}`)
    await assertNodeExecutionFence(tx, node, execution)
    execution.signal?.throwIfAborted()
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
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId)
        )
      )
    if (!node) throw new Error(`节点不存在：${nodeId}`)
    return isStaleInTransaction(tx, node)
  })
}
/** 在节点入队前记录本次将消费的真实上游输出指纹。 */
export async function captureNodeInputFingerprint(nodeId: string): Promise<string | null> {
  const database = await getDb()
  return withTransaction(database, async (tx) => {
    const [node] = await tx
      .select({ id: canvasNodes.id, data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId)
        )
      )
      .for('update')
    if (!node) throw new Error(`节点不存在：${nodeId}`)
    const dependencies = await dependencyHashes(tx, nodeId)
    if (dependencies.length === 0) return null
    const inputFingerprint = computeContentHash(dependencies)
    await tx
      .update(canvasNodes)
      .set({
        data: patchPayload(node.data, { inputFingerprint }),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId)
        )
      )
    return inputFingerprint
  })
}

/** 显式重新生成使用的受控失效，不伪造上游变化，也不放宽通用状态转换。 */
export async function invalidateNodeForRegeneration(
  nodeId: string,
  reason: 'manual-regenerate' | 'repair-upstream'
): Promise<void> {
  const database = await getDb()
  const projectId = await withTransaction(database, async (tx) => {
    const [node] = await tx
      .select({
        projectId: canvasNodes.projectId,
        status: canvasNodes.status,
        data: canvasNodes.data,
      })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId)
        )
      )
      .for('update')
    if (!node) throw new Error(`节点不存在：${nodeId}`)
    if (fromPersistedStatus(node.status) !== 'success') {
      throw new Error(`只有成功节点可以显式失效：${nodeId}`)
    }
    await tx
      .update(canvasNodes)
      .set({
        status: 'stale',
        data: patchPayload(node.data, {
          invalidationReason: reason,
          invalidatedAt: new Date().toISOString(),
        }),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId)
        )
      )
    return node.projectId
  })
  try {
    statusBus.publishStatus(projectId, nodeId, 'stale')
  } catch {
    // 推送失败不反向破坏已提交状态。
  }
}

async function isStaleInTransaction(
  tx: TransactionContext,
  node: { id: string; data: unknown }
): Promise<boolean> {
  const dependencies = await dependencyHashes(tx, node.id)
  if (dependencies.length === 0) return false
  return readInputFingerprint(node.data) !== computeContentHash(dependencies)
}

async function dependencyHashes(
  tx: TransactionContext,
  nodeId: string
): Promise<Array<{ id: string; outputContentHash: string | null }>> {
  const incoming = await tx
    .select({ source: canvasEdges.source })
    .from(canvasEdges)
    .where(
      and(
        eq(canvasEdges.workspaceId, currentWorkspaceId()),
        eq(canvasEdges.target, nodeId)
      )
    )
  if (incoming.length === 0) return []

  const nodes = await tx
    .select({ id: canvasNodes.id, data: canvasNodes.data })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, currentWorkspaceId()),
        inArray(
          canvasNodes.id,
          incoming.map(({ source }) => source)
        )
      )
    )
  return nodes
    .map((node) => ({
      id: node.id,
      outputContentHash: readOutputContentHash(node.data),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}
