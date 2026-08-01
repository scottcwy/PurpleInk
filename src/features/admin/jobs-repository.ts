import 'server-only'
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { pipelineRuns, taskAttempts } from '@/lib/db/schema'
import { normalizeJobRow, type AdminJobRow } from './operational-projections'

export interface AdminJobsQuery {
  status?: string
  page?: number
  pageSize?: number
}

export interface AdminJobsPage {
  items: AdminJobRow[]
  page: number
  pageSize: number
}

export async function listAdminJobs(input: AdminJobsQuery = {}): Promise<AdminJobsPage> {
  const page = positiveInteger(input.page, 1)
  const pageSize = Math.min(positiveInteger(input.pageSize, 50), 100)
  const db = await getDb()
  const condition = jobStatusCondition(input.status)
  const rows = await db
    .select({
      runId: pipelineRuns.id,
      runStatus: pipelineRuns.status,
      workflowVersion: pipelineRuns.workflowVersion,
      runCreatedAt: pipelineRuns.createdAt,
      attemptId: taskAttempts.id,
      taskId: taskAttempts.taskId,
      entityType: taskAttempts.entityType,
      attemptNo: taskAttempts.attemptNo,
      attemptStatus: taskAttempts.status,
      attemptCreatedAt: taskAttempts.createdAt,
      attemptCompletedAt: taskAttempts.completedAt,
      failure: taskAttempts.failure,
    })
    .from(taskAttempts)
    .innerJoin(
      pipelineRuns,
      and(
        eq(taskAttempts.workspaceId, pipelineRuns.workspaceId),
        eq(taskAttempts.runId, pipelineRuns.id),
      ),
    )
    .where(condition)
    .orderBy(sql`${taskAttempts.createdAt} desc nulls last`)
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return { items: rows.map(normalizeJobRow), page, pageSize }
}

export async function getAdminJob(id: string): Promise<AdminJobRow[] | null> {
  const db = await getDb()
  const rows = await db
    .select({
      runId: pipelineRuns.id,
      runStatus: pipelineRuns.status,
      workflowVersion: pipelineRuns.workflowVersion,
      runCreatedAt: pipelineRuns.createdAt,
      attemptId: taskAttempts.id,
      taskId: taskAttempts.taskId,
      entityType: taskAttempts.entityType,
      attemptNo: taskAttempts.attemptNo,
      attemptStatus: taskAttempts.status,
      attemptCreatedAt: taskAttempts.createdAt,
      attemptCompletedAt: taskAttempts.completedAt,
      failure: taskAttempts.failure,
    })
    .from(pipelineRuns)
    .leftJoin(
      taskAttempts,
      and(
        eq(taskAttempts.workspaceId, pipelineRuns.workspaceId),
        eq(taskAttempts.runId, pipelineRuns.id),
      ),
    )
    .where(or(eq(pipelineRuns.id, id), eq(taskAttempts.id, id)))
    .orderBy(desc(taskAttempts.createdAt))
    .limit(100)
  return rows.length > 0 ? rows.map(normalizeJobRow) : null
}

function jobStatusCondition(status: string | undefined): SQL | undefined {
  if (!status || status === 'all') return undefined
  return eq(taskAttempts.status, status)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : fallback
}
