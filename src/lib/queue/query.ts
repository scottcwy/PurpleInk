import 'server-only'

import { and, eq } from 'drizzle-orm'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { pipelineRuns, taskAttempts } from '@/lib/db/schema/index'
import type { JobStatus } from './types'

export interface JobSnapshot {
  id: string
  projectId: string
  nodeId: string | null
  kind: string
  status: JobStatus
  attempts: number
  error: string | null
}

export async function getJobSnapshot(
  projectId: string,
  jobId: string
): Promise<JobSnapshot | null> {
  const database = await getDb()
  const [row] = await database
    .select({
      id: taskAttempts.id,
      projectId: pipelineRuns.projectId,
      entityType: taskAttempts.entityType,
      entityId: taskAttempts.entityId,
      taskId: taskAttempts.taskId,
      status: taskAttempts.status,
      attemptNo: taskAttempts.attemptNo,
      failure: taskAttempts.failure,
    })
    .from(taskAttempts)
    .innerJoin(
      pipelineRuns,
      and(
        eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
        eq(pipelineRuns.id, taskAttempts.runId)
      )
    )
    .where(
      and(
        eq(taskAttempts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(taskAttempts.id, jobId),
        eq(pipelineRuns.projectId, projectId)
      )
    )
    .limit(1)
  if (!row) return null
  const status = toJobStatus(row.status)
  return {
    id: row.id,
    projectId: row.projectId,
    nodeId: row.entityType === 'node' ? row.entityId : null,
    kind: row.taskId.startsWith('legacy.')
      ? row.taskId.slice('legacy.'.length)
      : row.taskId,
    status,
    attempts: row.attemptNo,
    error: failureMessage(row.failure),
  }
}

function toJobStatus(status: string): JobStatus {
  if (status === 'queued') return 'pending'
  if (status === 'succeeded') return 'done'
  if (status === 'running' || status === 'failed') return status
  throw new Error(`未知作业状态：${status}`)
}

function failureMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const message = (value as Record<string, unknown>).message
  return typeof message === 'string' ? message : null
}
