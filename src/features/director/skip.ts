import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { commitArtifactRecord } from '@/features/artifacts'
import {
  getCanvasGraph,
  transitionNodeStatus,
  type CanvasGraphNode,
  type CanvasNodeType,
} from '@/features/canvas'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { pipelineRuns, taskAttempts } from '@/lib/db/schema/index'
import { queueFingerprint } from '@/lib/queue/attempt-checkpoint'
import { completeAttempt } from '@/lib/queue/attempt-completion'
import { leaseDeadline } from '@/lib/queue/lease'
import { storage } from '@/lib/storage'
import type { StorageAdapter } from '@/lib/storage'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from '@/lib/workflow/version'
import { advancePipeline } from './advance'
import type { NodeActionResult } from './recovery'
import {
  isSkippableFromStatus,
  isSkippableNodeType,
  SKIP_REASON_MAX_LENGTH,
  SKIP_REASON_MIN_LENGTH,
} from './skip-policy'

/** 跳过请求被业务规则拒绝（类型不可跳过 / 状态非法 / 原因缺失）；route 层映射为 422。 */
export class SkipRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkipRejectedError'
  }
}

export interface SkipNodeInput {
  projectId: string
  nodeId: string
  reason: string
}

const SKIP_TASK_KIND = 'skip-node'
export const SKIP_MARKER_ARTIFACT_KIND = 'node-skip-marker'

/**
 * 用户手动跳过一个可降级的 shot 环节（阶段 3 护栏，见 failure-patterns 模式 H）。
 *
 * 同步序列：校验 → 内联创建 running run/attempt（同步执行也持有租约，
 * 避免 sweep 收尸）→ 落盘并登记 node-skip-marker 产物（先写完再登记，
 * 哈希取实际字节，模式 G）→ 节点转 skipped（写 skipMeta）→ 推进下游。
 */
export async function skipNodeAction(
  input: SkipNodeInput
): Promise<NodeActionResult> {
  const reason = input.reason.trim()
  if (
    reason.length < SKIP_REASON_MIN_LENGTH ||
    reason.length > SKIP_REASON_MAX_LENGTH
  ) {
    throw new SkipRejectedError('跳过原因必填（1-200 字）')
  }
  await assertProjectWorkflowSupported(input.projectId)
  const node = await loadSkippableNode(input.projectId, input.nodeId)

  const database = await getDb()
  const workspaceId = currentWorkspaceId()
  const skippedAt = new Date().toISOString()
  const attemptId = await createSkipAttempt(database, workspaceId, input)
  try {
    await registerSkipMarker(database, storage, {
      projectId: input.projectId,
      nodeId: input.nodeId,
      nodeType: node.type,
      reason,
      skippedAt,
      attemptId,
    })
    await completeAttempt(database, workspaceId, attemptId, 'succeeded')
  } catch (error) {
    // 跳过是人工决策，失败不进自动重试，直接终态并保留失败描述。
    await completeAttempt(
      database,
      workspaceId,
      attemptId,
      'failed',
      error instanceof Error ? error.message : String(error),
      { allowAutoRetry: false }
    ).catch(() => undefined)
    throw error
  }
  await transitionNodeStatus(input.nodeId, 'skipped', {
    skipMeta: { reason, at: skippedAt },
  })
  const advanced = await advancePipeline(input.projectId, input.nodeId)
  return {
    ok: true,
    action: 'skip',
    requestedNodeId: input.nodeId,
    queuedNodeId: input.nodeId,
    jobId: attemptId,
    message:
      advanced.enqueuedNodeIds.length > 0
        ? '已跳过此环节，成片将以占位/缺省产出继续，并已推进下游'
        : '已跳过此环节，成片将以占位/缺省产出继续',
  }
}

async function loadSkippableNode(
  projectId: string,
  nodeId: string
): Promise<CanvasGraphNode> {
  const graph = await getCanvasGraph(projectId)
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`节点不存在：${nodeId}`)
  if (!isSkippableNodeType(node.type)) {
    throw new SkipRejectedError('该环节是成片的硬前置，不能跳过')
  }
  if (!isSkippableFromStatus(node.status)) {
    throw new SkipRejectedError(
      '节点当前状态不允许跳过（仅失败、过期或已取消的节点可跳过）'
    )
  }
  return node
}

/**
 * 跳过没有队列作业承载，但 artifact 归属链要求 running 的 run + attempt
 * （assertAttemptFence）：在请求上下文内内联创建一次性 attempt，
 * 字段口径与 in-process-queue 的 enqueue + claim 保持一致。
 */
async function createSkipAttempt(
  database: Db,
  workspaceId: string,
  input: SkipNodeInput
): Promise<string> {
  const runId = randomUUID()
  const attemptId = randomUUID()
  const payload = { projectId: input.projectId, nodeId: input.nodeId }
  const fingerprint = queueFingerprint(SKIP_TASK_KIND, payload)
  await database.transaction(async (transaction) => {
    await transaction.insert(pipelineRuns).values({
      workspaceId,
      id: runId,
      projectId: input.projectId,
      status: 'running',
      workflowVersion: serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION),
      fingerprint,
      startedAt: new Date(),
    })
    await transaction.insert(taskAttempts).values({
      workspaceId,
      id: attemptId,
      runId,
      taskId: `legacy.${SKIP_TASK_KIND}`,
      entityType: 'node',
      entityId: input.nodeId,
      attemptNo: 1,
      status: 'running',
      fingerprint,
      checkpoint: { schemaVersion: 1, kind: SKIP_TASK_KIND, payload },
      startedAt: new Date(),
      leaseExpiresAt: leaseDeadline(),
    })
  })
  return attemptId
}

interface SkipMarkerInput {
  projectId: string
  nodeId: string
  nodeType: CanvasNodeType
  reason: string
  skippedAt: string
  attemptId: string
}

/** 先把 marker 完整落盘，再以实际字节的 SHA-256 登记 artifact（模式 G）。 */
async function registerSkipMarker(
  database: Db,
  storageAdapter: StorageAdapter,
  input: SkipMarkerInput
): Promise<void> {
  const storageKey = `node-skip/${input.projectId}/${input.nodeId}.json`
  const marker = {
    schemaVersion: 1,
    projectId: input.projectId,
    nodeId: input.nodeId,
    nodeType: input.nodeType,
    reason: input.reason,
    skippedAt: input.skippedAt,
  }
  await storageAdapter.put(storageKey, JSON.stringify(marker, null, 2))
  // 哈希与大小取写入后的实际字节，而不是内存里的源字符串。
  const bytes = await storageAdapter.get(storageKey)
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  try {
    await commitArtifactRecord(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'node',
      aggregateId: input.nodeId,
      kind: SKIP_MARKER_ARTIFACT_KIND,
      schemaVersion: 'cvc.node-skip-marker/v1',
      storageKey,
      sizeBytes: bytes.byteLength,
      contentHash,
      attemptId: input.attemptId,
    })
  } catch (error) {
    try {
      await storageAdapter.delete(storageKey)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'skip marker 提交失败且存储补偿不完整'
      )
    }
    throw error
  }
}
