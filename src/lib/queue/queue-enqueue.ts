import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
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
import type { QueueEnqueueReceipt } from './types'

export interface QueueEnqueueOptions {
  projectId?: string
  nodeId?: string
  requestedByUserId?: string
  workflowVersion?: string
  requireAutomaticAdvance?: boolean
  reuseActiveAttempt?: boolean
}

export class AutomaticAdvanceDisabledError extends Error {
  readonly code = 'AUTOMATIC_ADVANCE_DISABLED'

  constructor() {
    super('automatic advance is disabled')
    this.name = 'AutomaticAdvanceDisabledError'
  }
}

export async function enqueueLegacyJob(
  kind: string,
  payload: Record<string, unknown>,
  opts: QueueEnqueueOptions,
): Promise<string> {
  return (await enqueueLegacyJobWithReceipt(kind, payload, opts)).attemptId
}

export async function enqueueLegacyJobWithReceipt(
  kind: string,
  payload: Record<string, unknown>,
  opts: QueueEnqueueOptions,
): Promise<QueueEnqueueReceipt> {
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
  return database.transaction(async (transaction) => {
    const [project] = await transaction
      .select({
        executionEpoch: projects.executionEpoch,
        workflowKind: projects.workflowKind,
        autopilot: projects.autopilot,
        directorContinuationEnabled: projects.directorContinuationEnabled,
      })
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
    if (
      opts.requireAutomaticAdvance
      && !isAutomaticAdvanceEnabled(project)
    ) {
      throw new AutomaticAdvanceDisabledError()
    }
    const entityType = opts.nodeId ? 'node' : 'project'
    const entityId = opts.nodeId ?? opts.projectId!
    if (opts.reuseActiveAttempt) {
      const [activeAttempt] = await transaction
        .select({
          id: taskAttempts.id,
          status: taskAttempts.status,
        })
        .from(taskAttempts)
        .innerJoin(pipelineRuns, and(
          eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
          eq(pipelineRuns.id, taskAttempts.runId),
        ))
        .where(and(
          eq(taskAttempts.workspaceId, workspaceId),
          eq(taskAttempts.taskId, `legacy.${kind}`),
          eq(taskAttempts.entityType, entityType),
          eq(taskAttempts.entityId, entityId),
          inArray(taskAttempts.status, ['queued', 'running']),
          eq(pipelineRuns.projectId, opts.projectId!),
          eq(pipelineRuns.executionEpoch, project.executionEpoch),
        ))
        .limit(1)
      if (activeAttempt) {
        return {
          attemptId: activeAttempt.id,
          status: activeAttempt.status as 'queued' | 'running',
          reused: true,
        }
      }
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
      entityId,
      attemptNo: 1,
      status: 'queued',
      fingerprint,
      checkpoint: { schemaVersion: 1, kind, payload },
      workUnitKey,
    })
    return {
      attemptId,
      status: 'queued',
      reused: false,
    }
  })
}

function isAutomaticAdvanceEnabled(project: {
  workflowKind: string
  autopilot: boolean
  directorContinuationEnabled: boolean
}): boolean {
  if (project.workflowKind === 'script') return project.autopilot
  if (project.workflowKind === 'audio') {
    return project.directorContinuationEnabled
  }
  return false
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
