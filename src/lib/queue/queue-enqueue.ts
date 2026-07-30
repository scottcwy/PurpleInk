import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import {
  currentUserId,
  currentWorkspaceId,
  SYSTEM_USER_ID,
} from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
} from '@/lib/db/schema/index'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from '@/lib/workflow/version'
import { queueFingerprint } from './attempt-checkpoint'

export interface QueueEnqueueOptions {
  projectId?: string
  nodeId?: string
  requestedByUserId?: string
  workflowVersion?: string
}

export async function enqueueLegacyJob(
  kind: string,
  payload: Record<string, unknown>,
  opts: QueueEnqueueOptions,
): Promise<string> {
  if (!opts.projectId) {
    throw new Error('legacy queue enqueue requires a trusted projectId')
  }
  const workspaceId = currentWorkspaceId()
  const contextUserId = opts.requestedByUserId ?? currentUserId()
  const requestedByUserId =
    contextUserId === SYSTEM_USER_ID ? null : contextUserId
  const database = await getDb()
  const runId = randomUUID()
  const attemptId = randomUUID()
  const fingerprint = queueFingerprint(kind, payload)
  await database.transaction(async (transaction) => {
    const [project] = await transaction
      .select({ executionEpoch: projects.executionEpoch })
      .from(projects)
      .where(and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, opts.projectId!),
      ))
      .limit(1)
      .for('update')
    if (!project) {
      throw new Error('legacy queue enqueue requires an existing project')
    }
    const workUnitKey = opts.nodeId
      ? await readWorkUnitKey(transaction, workspaceId, opts.projectId!, opts.nodeId)
      : null
    await transaction.insert(pipelineRuns).values({
      workspaceId,
      id: runId,
      projectId: opts.projectId!,
      requestedByUserId,
      status: 'queued',
      executionEpoch: project.executionEpoch,
      workflowVersion:
        opts.workflowVersion ?? serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION),
      fingerprint,
    })
    await transaction.insert(taskAttempts).values({
      workspaceId,
      id: attemptId,
      runId,
      taskId: `legacy.${kind}`,
      entityType: opts.nodeId ? 'node' : 'project',
      entityId: opts.nodeId ?? opts.projectId!,
      attemptNo: 1,
      status: 'queued',
      fingerprint,
      checkpoint: { schemaVersion: 1, kind, payload },
      workUnitKey,
    })
  })
  return attemptId
}

type QueueTransaction = Parameters<
  Parameters<Awaited<ReturnType<typeof getDb>>['transaction']>[0]
>[0]

async function readWorkUnitKey(
  transaction: QueueTransaction,
  workspaceId: string,
  projectId: string,
  nodeId: string,
): Promise<string | null> {
  const [node] = await transaction
    .select({ data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(
      eq(canvasNodes.workspaceId, workspaceId),
      eq(canvasNodes.projectId, projectId),
      eq(canvasNodes.id, nodeId),
    ))
    .limit(1)
  const payload = node?.data?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const laneKey = (payload as Record<string, unknown>).laneKey
  return typeof laneKey === 'string' && laneKey.length > 0 ? laneKey : null
}
