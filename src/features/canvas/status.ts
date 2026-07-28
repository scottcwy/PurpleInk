import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  canvasEdges,
  canvasNodes,
  type VersionedPayload,
} from '@/lib/db/schema/index'
import {
  withTransaction,
  type TransactionContext,
} from '@/lib/db/transaction'
import { statusBus } from '@/lib/stream/status-bus'
import {
  computeContentHash,
  readInputFingerprint,
  readOutputContentHash,
} from './content-hash'
import type { NodeStatus } from './types'

export type { NodeStatus } from './types'
export { computeContentHash } from './content-hash'

const ALLOWED_TRANSITIONS: Record<NodeStatus, readonly NodeStatus[]> = {
  idle: ['pending'],
  pending: ['running', 'cancelled'],
  running: ['success', 'failed', 'cancelled'],
  success: ['stale'],
  failed: ['pending', 'stale', 'skipped'],
  cancelled: ['pending', 'stale', 'skipped'],
  stale: ['pending', 'skipped'],
  skipped: ['pending'],
}

/** 跳过审计元数据：转入 skipped 时写入 data.payload.skipMeta。 */
export interface SkipMeta {
  reason: string
  at: string
}

/** 原子校验并写入节点状态；stale 只允许由真实上游变化触发。 */
export async function transitionNodeStatus(
  nodeId: string,
  next: NodeStatus,
  options?: { skipMeta?: SkipMeta }
): Promise<void> {
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
    const current = fromPersistedStatus(node.status)
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new Error(`非法节点状态转换：${current} -> ${next}`)
    }
    if (next === 'stale' && !(await isStaleInTransaction(tx, node))) {
      throw new Error(`节点上游内容未变化，不能标记为 stale：${nodeId}`)
    }
    const nextData = resolveTransitionData(node.data, current, next, options?.skipMeta)
    await tx
      .update(canvasNodes)
      .set({
        status: toPersistedStatus(next),
        ...(nextData === null ? {} : { data: nextData }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId)
        )
      )
    return node.projectId
  })
  // 严格在事务提交之后发布（回滚路径零事件）；发布失败不影响状态迁移。
  try {
    statusBus.publishStatus(projectId, nodeId, next)
  } catch {
    // 推送是体验增强，不反向阻断状态机。
  }
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
        updatedAt: new Date(),
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
        updatedAt: new Date(),
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

/**
 * 上一次失败留下的错误字段。成功转换必须清掉它们，否则 `succeeded` 节点会长期
 * 携带一条早已过期的失败描述（实测存在：一个 succeeded 的 shot-split 仍带着
 * 前一次尝试的 directorError），DB 投影与节点状态互相矛盾。
 */
const STAGE_ERROR_PAYLOAD_KEYS = ['directorError', 'renderError'] as const

const SKIP_META_PAYLOAD_KEY = 'skipMeta'

/**
 * 状态迁移伴随的 data 修订：
 * - 转 success / skipped 时清理旧错误字段（skipped 节点不应继续显示可重试错误）；
 * - 转 skipped 时写入 skipMeta（原因与时刻，可审计）；
 * - skipped 转回 pending（重新执行恢复）时移除 skipMeta，离开跳过态即恢复诚实。
 * 无需修订时返回 null，避免无意义写入。
 */
function resolveTransitionData(
  data: VersionedPayload,
  current: NodeStatus,
  next: NodeStatus,
  skipMeta: SkipMeta | undefined
): VersionedPayload | null {
  if (next === 'success') return withoutStageErrors(data)
  if (next === 'skipped') {
    if (!skipMeta) throw new Error('转入 skipped 必须提供 skipMeta（跳过原因）')
    const cleared = withoutStageErrors(data) ?? data
    return patchPayload(cleared, { [SKIP_META_PAYLOAD_KEY]: skipMeta })
  }
  if (current === 'skipped') {
    return withoutPayloadKeys(data, [SKIP_META_PAYLOAD_KEY])
  }
  return null
}

/** 返回去掉错误字段后的 data；本来就没有可清理字段时返回 null，避免无意义写入。 */
function withoutStageErrors(value: VersionedPayload): VersionedPayload | null {
  return withoutPayloadKeys(value, STAGE_ERROR_PAYLOAD_KEYS)
}

function withoutPayloadKeys(
  value: VersionedPayload,
  keys: readonly string[]
): VersionedPayload | null {
  const payload = value.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const entries = payload as Record<string, unknown>
  const present = keys.filter((key) =>
    Object.hasOwn(entries, key)
  )
  if (present.length === 0) return null
  const nextPayload = { ...entries }
  for (const key of present) delete nextPayload[key]
  return { ...value, payload: nextPayload }
}

function patchPayload(
  value: VersionedPayload,
  patch: Record<string, unknown>
): VersionedPayload {
  const current =
    value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
      ? value.payload as Record<string, unknown>
      : {}
  return { ...value, payload: { ...current, ...patch } }
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
    status === 'stale' ||
    status === 'skipped'
  ) {
    return status
  }
  throw new Error(`未知节点状态：${status}`)
}
