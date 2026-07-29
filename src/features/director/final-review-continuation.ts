import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { taskAttempts } from '@/lib/db/schema/index'
import { queueFingerprint } from '@/lib/queue/attempt-checkpoint'
import {
  enqueueDirectorStage,
  type DirectorStageJobInput,
} from './queue-handler'

export interface FinalReviewContinuationInput {
  projectId: string
  exportNodeId: string
  mode: 'complete' | 'degraded'
  finalArtifactHash: string
  confirmationFingerprint?: string
}

interface FinalReviewContinuationDependencies {
  findExistingAttempt(input: {
    nodeId: string
    fingerprint: string
  }): Promise<string | null>
  enqueue(input: DirectorStageJobInput): Promise<string>
}

export async function continueExportFinalReview(
  input: FinalReviewContinuationInput,
  dependencies: FinalReviewContinuationDependencies = defaultDependencies()
): Promise<string> {
  const payload: DirectorStageJobInput = {
    projectId: input.projectId,
    nodeId: input.exportNodeId,
    stage: 'FINALIZE',
    finalArtifactHash: input.finalArtifactHash,
  }
  const fingerprint = queueFingerprint('director-stage', payload)
  const existing = await dependencies.findExistingAttempt({
    nodeId: input.exportNodeId,
    fingerprint,
  })
  if (existing) return existing
  return dependencies.enqueue(payload)
}

function defaultDependencies(): FinalReviewContinuationDependencies {
  return {
    findExistingAttempt: findExistingFinalReviewAttempt,
    enqueue: (input) =>
      enqueueDirectorStage(input, undefined, { preservePending: true }),
  }
}

async function findExistingFinalReviewAttempt(input: {
  nodeId: string
  fingerprint: string
}): Promise<string | null> {
  const database = await getDb()
  const [attempt] = await database
    .select({ id: taskAttempts.id })
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.workspaceId, currentWorkspaceId()),
        eq(taskAttempts.entityType, 'node'),
        eq(taskAttempts.entityId, input.nodeId),
        eq(taskAttempts.fingerprint, input.fingerprint),
        inArray(taskAttempts.status, ['queued', 'running', 'succeeded'])
      )
    )
    .limit(1)
  return attempt?.id ?? null
}
