import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { ProviderDispatchWaitError } from '@/features/ai/provider-dispatch-wait-error'
import type { WorkflowFault } from '@/features/canvas/workflow-fault'
import type { Db } from '@/lib/db/client'
import {
  pipelineRuns,
  taskAttempts,
  type VersionedPayload,
} from '@/lib/db/schema'

export const MAX_PROVIDER_WAIT_MS = 15 * 60_000
const FALLBACK_PROVIDER_WAIT_MS = 15_000

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface ProviderWaitAttempt {
  runId: string
  taskId: string
  entityType: string
  entityId: string
  attemptNo: number
  fingerprint: string
  checkpoint: VersionedPayload
}

export async function scheduleProviderRateLimitWait(
  transaction: Transaction,
  workspaceId: string,
  attemptId: string,
  attempt: ProviderWaitAttempt,
  fault: WorkflowFault,
  resumeAt: Date,
): Promise<void> {
  await transaction
    .update(taskAttempts)
    .set({
      status: 'superseded',
      failure: fault,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(taskAttempts.workspaceId, workspaceId),
      eq(taskAttempts.id, attemptId),
      eq(taskAttempts.status, 'running'),
    ))
  await transaction.insert(taskAttempts).values({
    workspaceId,
    id: randomUUID(),
    runId: attempt.runId,
    taskId: attempt.taskId,
    entityType: attempt.entityType,
    entityId: attempt.entityId,
    attemptNo: attempt.attemptNo + 1,
    status: 'queued',
    fingerprint: attempt.fingerprint,
    checkpoint: patchQueueMeta(attempt.checkpoint, {
      ordinaryAttemptNo: ordinaryAttemptNo(attempt),
      providerWaitStartedAt: providerWaitStartedAt(attempt.checkpoint).toISOString(),
    }),
    visibleAt: resumeAt,
  })
  await requeueRun(transaction, workspaceId, attempt.runId)
}

export async function scheduleProviderDispatchWait(
  transaction: Transaction,
  workspaceId: string,
  attemptId: string,
  attempt: ProviderWaitAttempt,
  failure: ProviderDispatchWaitError,
  resumeAt: Date,
): Promise<void> {
  await transaction
    .update(taskAttempts)
    .set({
      status: 'queued',
      failure: null,
      checkpoint: patchQueueMeta(attempt.checkpoint, {
        ordinaryAttemptNo: ordinaryAttemptNo(attempt),
        providerScopeKey: failure.scopeKey,
        providerWaitReason: failure.waitReason,
      }),
      visibleAt: resumeAt,
      leaseExpiresAt: null,
      startedAt: null,
      completedAt: null,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(taskAttempts.workspaceId, workspaceId),
      eq(taskAttempts.id, attemptId),
      eq(taskAttempts.status, 'running'),
    ))
  await requeueRun(transaction, workspaceId, attempt.runId)
}

export function ordinaryAttemptNo(attempt: {
  attemptNo: number
  checkpoint: VersionedPayload
}): number {
  const meta = queueMeta(attempt.checkpoint)
  return typeof meta.ordinaryAttemptNo === 'number'
    ? meta.ordinaryAttemptNo
    : attempt.attemptNo
}

export function providerWaitRemaining(checkpoint: VersionedPayload): boolean {
  return Date.now() - providerWaitStartedAt(checkpoint).getTime() <
    MAX_PROVIDER_WAIT_MS
}

export function boundedProviderResumeAt(
  fault: WorkflowFault,
  checkpoint: VersionedPayload,
): Date {
  const startedAt = providerWaitStartedAt(checkpoint)
  const deadline = startedAt.getTime() + MAX_PROVIDER_WAIT_MS
  const projected = fault.provider?.retryAt
    ? Date.parse(fault.provider.retryAt)
    : Date.now() + FALLBACK_PROVIDER_WAIT_MS
  const valid = Number.isFinite(projected)
    ? projected
    : Date.now() + FALLBACK_PROVIDER_WAIT_MS
  return new Date(Math.min(Math.max(valid, Date.now()), deadline))
}

export function patchQueueMeta(
  checkpoint: VersionedPayload,
  patch: Record<string, unknown>,
): VersionedPayload {
  return { ...checkpoint, queueMeta: { ...queueMeta(checkpoint), ...patch } }
}

function providerWaitStartedAt(checkpoint: VersionedPayload): Date {
  const value = queueMeta(checkpoint).providerWaitStartedAt
  if (typeof value === 'string') {
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return new Date(timestamp)
  }
  return new Date()
}

function queueMeta(checkpoint: VersionedPayload): Record<string, unknown> {
  const value = checkpoint.queueMeta
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function requeueRun(
  transaction: Transaction,
  workspaceId: string,
  runId: string,
): Promise<void> {
  await transaction
    .update(pipelineRuns)
    .set({ status: 'queued', completedAt: null, updatedAt: sql`now()` })
    .where(and(
      eq(pipelineRuns.workspaceId, workspaceId),
      eq(pipelineRuns.id, runId),
    ))
}
