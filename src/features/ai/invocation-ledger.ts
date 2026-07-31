import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import {
  currentUserId,
  currentWorkspaceId,
  SYSTEM_USER_ID,
} from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  aiInvocations,
  pipelineRuns,
  taskAttempts,
} from '@/lib/db/schema'
import type { VersionedPayload } from '@/lib/db/schema/core'
import type { ProviderCapability } from './provider-registry'

export type InvocationFunding = 'managed' | 'byok' | 'custom'

export interface InvocationIdentity {
  invocationId: string
  attemptId?: string
  invocationNo: number
  repairNo?: number
  provider: string
  model: string
  funding: Exclude<InvocationFunding, 'managed'>
  capability: ProviderCapability
  operation: string
  source?: string
  inputHash?: string
}

export async function createUnbilledInvocation(
  input: InvocationIdentity,
): Promise<void> {
  const database = await getDb()
  const workspaceId = currentWorkspaceId()
  const execution = input.attemptId
    ? await resolveExecution(workspaceId, input.attemptId)
    : null
  const contextUserId = currentUserId()
  const actorUserId = execution?.actorUserId
    ?? (contextUserId === SYSTEM_USER_ID ? null : contextUserId)
  if (!actorUserId) {
    throw new Error('AI invocation requires an attributable user')
  }
  await database.insert(aiInvocations).values({
    workspaceId,
    id: input.invocationId,
    runId: execution?.runId,
    attemptId: input.attemptId,
    taskId: execution?.taskId,
    invocationNo: input.invocationNo,
    repairNo: input.repairNo ?? 0,
    provider: input.provider,
    model: input.model,
    actorUserId,
    funding: input.funding,
    capability: input.capability,
    operation: input.operation,
    source: input.source ?? 'products',
    telemetryVersion: 2,
    inputHash: input.inputHash,
    billingStatus: 'not_applicable',
  }).onConflictDoNothing()
}

export async function markProviderInvocationStarted(
  invocationId: string,
): Promise<void> {
  const database = await getDb()
  await database.update(aiInvocations).set({
    providerStartedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(aiInvocations.workspaceId, currentWorkspaceId()),
    eq(aiInvocations.id, invocationId),
    eq(aiInvocations.status, 'running'),
    isNull(aiInvocations.providerStartedAt),
  ))
}

export async function settleUnbilledInvocation(input: {
  invocationId: string
  status: 'succeeded' | 'failed'
  usageStatus: 'reported' | 'unavailable'
  usage: VersionedPayload
  outputHash?: string
  providerDurationMs: number
  failureKind?: string
}): Promise<void> {
  const database = await getDb()
  const now = new Date()
  await database.update(aiInvocations).set({
    status: input.status,
    usageStatus: input.usageStatus,
    usage: input.usage,
    outputHash: input.outputHash,
    providerCompletedAt: now,
    providerDurationMs: input.providerDurationMs,
    failureKind: input.failureKind,
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(aiInvocations.workspaceId, currentWorkspaceId()),
    eq(aiInvocations.id, input.invocationId),
    eq(aiInvocations.billingStatus, 'not_applicable'),
    eq(aiInvocations.status, 'running'),
  ))
}

export async function releaseUnbilledInvocation(
  invocationId: string,
): Promise<void> {
  const database = await getDb()
  const now = new Date()
  await database.update(aiInvocations).set({
    status: 'cancelled',
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(aiInvocations.workspaceId, currentWorkspaceId()),
    eq(aiInvocations.id, invocationId),
    eq(aiInvocations.billingStatus, 'not_applicable'),
    eq(aiInvocations.status, 'running'),
    isNull(aiInvocations.providerStartedAt),
  ))
}

async function resolveExecution(workspaceId: string, attemptId: string) {
  const database = await getDb()
  const [row] = await database.select({
    runId: taskAttempts.runId,
    taskId: taskAttempts.taskId,
    actorUserId: pipelineRuns.requestedByUserId,
  }).from(taskAttempts).innerJoin(
    pipelineRuns,
    and(
      eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
      eq(pipelineRuns.id, taskAttempts.runId),
    ),
  ).where(and(
    eq(taskAttempts.workspaceId, workspaceId),
    eq(taskAttempts.id, attemptId),
  )).limit(1)
  if (!row) throw new Error('task attempt does not exist')
  return row
}
