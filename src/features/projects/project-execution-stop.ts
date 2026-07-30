import 'server-only'
import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm'
import { releaseManagedReservation } from '@/features/billing'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { abortAttempts } from '@/lib/queue/execution-cancellation'
import {
  aiInvocations,
  canvasNodes,
  pipelineRuns,
  projects,
  providerDispatches,
  taskAttempts,
  workflowConcurrencyLeases,
} from '@/lib/db/schema'

const STOP_FAILURE = {
  schemaVersion: 2,
  code: 'TASK_INTERRUPTED',
  message: '用户已停止项目执行',
  retryable: true,
  recovery: 'restart_project',
}

export interface ProjectExecutionStopResult {
  autopilot: false
  status: 'stopping' | 'stopped'
  cancelledAttempts: number
  cancelledRuns: number
  cancelledTickets: number
  cancelledLeases: number
  remainingRunning: number
}

export class ProjectExecutionStopError extends Error {
  readonly code = 'PROJECT_NOT_FOUND'
  readonly statusCode = 404

  constructor() {
    super('项目不存在')
    this.name = 'ProjectExecutionStopError'
  }
}

export interface ProjectExecutionStopDependencies {
  database?: Db
  releaseReservation?: typeof releaseManagedReservation
}

/**
 * 取消一个项目当前代次的所有排队执行，并对已领取作业发出协作取消请求。
 * epoch 是迟到写回的硬栅栏；共享 Web/worker 进程不在此处终止。
 */
export async function stopProjectExecution(
  projectId: string,
  dependencies: ProjectExecutionStopDependencies = {},
): Promise<ProjectExecutionStopResult> {
  const database = dependencies.database ?? await getDb()
  const workspaceId = currentWorkspaceId()
  const snapshot = await database.transaction(async (transaction) => {
    const [project] = await transaction
      .select({
        autopilot: projects.autopilot,
        executionEpoch: projects.executionEpoch,
      })
      .from(projects)
      .where(and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
      ))
      .limit(1)
      .for('update')
    if (!project) throw new ProjectExecutionStopError()

    const attempts = await transaction
      .select({
        id: taskAttempts.id,
        entityType: taskAttempts.entityType,
        entityId: taskAttempts.entityId,
        workUnitKey: taskAttempts.workUnitKey,
        status: taskAttempts.status,
        cancelRequestedAt: taskAttempts.cancelRequestedAt,
      })
      .from(taskAttempts)
      .innerJoin(
        pipelineRuns,
        and(
          eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
          eq(pipelineRuns.id, taskAttempts.runId),
        ),
      )
      .where(and(
        eq(taskAttempts.workspaceId, workspaceId),
        eq(pipelineRuns.projectId, projectId),
        inArray(taskAttempts.status, ['queued', 'running']),
      ))

    const queued = attempts.filter((attempt) => attempt.status === 'queued')
    const running = attempts.filter((attempt) => attempt.status === 'running')
    const shouldFence = project.autopilot
      || queued.length > 0
      || running.some((attempt) => attempt.cancelRequestedAt === null)
    if (shouldFence) {
      await transaction
        .update(projects)
        .set({
          autopilot: false,
          executionEpoch: project.executionEpoch + 1,
          updatedAt: sql`now()`,
        })
        .where(and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.id, projectId),
        ))
    }

    const queuedIds = queued.map(({ id }) => id)
    const runningIds = running.map(({ id }) => id)
    if (queuedIds.length > 0) {
      await transaction
        .update(taskAttempts)
        .set({
          status: 'cancelled',
          failure: STOP_FAILURE,
          cancelRequestedAt: sql`now()`,
          leaseExpiresAt: null,
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(
          eq(taskAttempts.workspaceId, workspaceId),
          inArray(taskAttempts.id, queuedIds),
          eq(taskAttempts.status, 'queued'),
        ))
    }
    if (runningIds.length > 0) {
      await transaction
        .update(taskAttempts)
        .set({ cancelRequestedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(
          eq(taskAttempts.workspaceId, workspaceId),
          inArray(taskAttempts.id, runningIds),
          eq(taskAttempts.status, 'running'),
        ))
    }

    const cancelledRuns = await transaction
      .update(pipelineRuns)
      .set({ status: 'cancelled', completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(
        eq(pipelineRuns.workspaceId, workspaceId),
        eq(pipelineRuns.projectId, projectId),
        inArray(pipelineRuns.status, ['triggering', 'queued']),
      ))
      .returning({ id: pipelineRuns.id })

    const activeWorkUnits = new Set(
      running.map(({ workUnitKey }) => workUnitKey).filter((value): value is string => !!value),
    )
    const cancellableLeases = await transaction
      .select({
        projectId: workflowConcurrencyLeases.projectId,
        workUnitKey: workflowConcurrencyLeases.workUnitKey,
      })
      .from(workflowConcurrencyLeases)
      .where(and(
        eq(workflowConcurrencyLeases.workspaceId, workspaceId),
        eq(workflowConcurrencyLeases.projectId, projectId),
        inArray(workflowConcurrencyLeases.status, ['waiting', 'active']),
      ))
    const leaseKeys = cancellableLeases
      .filter(({ workUnitKey }) => !activeWorkUnits.has(workUnitKey))
      .map(({ workUnitKey }) => workUnitKey)
    let cancelledLeases = 0
    if (leaseKeys.length > 0) {
      const released = await transaction
        .update(workflowConcurrencyLeases)
        .set({
          status: 'cancelled',
          leaseExpiresAt: null,
          releasedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(
          eq(workflowConcurrencyLeases.workspaceId, workspaceId),
          eq(workflowConcurrencyLeases.projectId, projectId),
          inArray(workflowConcurrencyLeases.workUnitKey, leaseKeys),
          inArray(workflowConcurrencyLeases.status, ['waiting', 'active']),
        ))
        .returning({ workUnitKey: workflowConcurrencyLeases.workUnitKey })
      cancelledLeases = released.length
    }

    const affectedAttemptIds = [...queuedIds, ...runningIds]
    let cancelledTickets = 0
    let reservationIds: string[] = []
    if (affectedAttemptIds.length > 0) {
      const tickets = await transaction
        .update(providerDispatches)
        .set({
          status: 'cancelled',
          releasedAt: sql`now()`,
        })
        .where(and(
          eq(providerDispatches.workspaceId, workspaceId),
          inArray(providerDispatches.attemptId, affectedAttemptIds),
          eq(providerDispatches.status, 'scheduled'),
        ))
        .returning({ id: providerDispatches.id })
      cancelledTickets = tickets.length

      const reservations = await transaction
        .select({ id: aiInvocations.id })
        .from(aiInvocations)
        .where(and(
          eq(aiInvocations.workspaceId, workspaceId),
          inArray(aiInvocations.attemptId, affectedAttemptIds),
          eq(aiInvocations.status, 'running'),
          eq(aiInvocations.billingStatus, 'reserved'),
          isNull(aiInvocations.providerStartedAt),
        ))
      reservationIds = reservations.map(({ id }) => id)
      await transaction
        .update(aiInvocations)
        .set({ status: 'cancelled', completedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(
          eq(aiInvocations.workspaceId, workspaceId),
          inArray(aiInvocations.attemptId, affectedAttemptIds),
          eq(aiInvocations.status, 'running'),
          notInArray(aiInvocations.billingStatus, ['reserved', 'settled']),
          isNull(aiInvocations.providerStartedAt),
        ))
    }

    const queuedNodeIds = queued
      .filter(({ entityType }) => entityType === 'node')
      .map(({ entityId }) => entityId)
    if (queuedNodeIds.length > 0) {
      await transaction
        .update(canvasNodes)
        .set({ status: 'cancelled', updatedAt: sql`now()` })
        .where(and(
          eq(canvasNodes.workspaceId, workspaceId),
          eq(canvasNodes.projectId, projectId),
          inArray(canvasNodes.id, queuedNodeIds),
          ne(canvasNodes.status, 'succeeded'),
        ))
    }

    return {
      cancelledAttempts: queuedIds.length,
      cancelledRuns: cancelledRuns.length,
      cancelledTickets,
      cancelledLeases,
      remainingRunning: runningIds.length,
      runningIds,
      reservationIds,
    }
  })

  abortAttempts(snapshot.runningIds)
  const release = dependencies.releaseReservation ?? releaseManagedReservation
  for (const invocationId of snapshot.reservationIds) {
    await release({ workspaceId, invocationId })
  }
  const status = snapshot.remainingRunning > 0 ? 'stopping' : 'stopped'
  console.info(status === 'stopping' ? '[project_stop_requested]' : '[project_stop_completed]', {
    projectId,
    remainingRunning: snapshot.remainingRunning,
    cancelledAttempts: snapshot.cancelledAttempts,
  })
  return {
    autopilot: false,
    status,
    cancelledAttempts: snapshot.cancelledAttempts,
    cancelledRuns: snapshot.cancelledRuns,
    cancelledTickets: snapshot.cancelledTickets,
    cancelledLeases: snapshot.cancelledLeases,
    remainingRunning: snapshot.remainingRunning,
  }
}
