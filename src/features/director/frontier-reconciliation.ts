import 'server-only'
import { sql } from 'drizzle-orm'
import {
  runInAuthContext,
  SYSTEM_USER_ID,
} from '@/lib/auth/workspace-context'
import type { Db } from '@/lib/db/client'
import type { PipelineStartResult } from './advance'
import { tryProjectFrontierLock } from './frontier-lock'

export interface DirectorFrontierCandidate {
  workspaceId: string
  projectId: string
}

interface ReconciliationDependencies {
  listCandidates?: (database: Db) => Promise<DirectorFrontierCandidate[]>
  resume?: (projectId: string) => Promise<PipelineStartResult>
  lockProject?: (
    projectId: string,
    operation: () => Promise<PipelineStartResult>,
  ) => Promise<PipelineStartResult | null>
}

export interface DirectorFrontierReconciliationResult {
  reconciledProjectIds: string[]
  failedProjectIds: string[]
  deferredProjectIds: string[]
}

/**
 * 恢复“节点已成功落库、但进程在调用 advancePipeline 前退出”的持久化断点。
 * 候选只包含 autopilot 已开启、当前无 active attempt 且已有 ready frontier 的项目。
 */
export async function reconcileDirectorFrontiers(
  database: Db,
  dependencies: ReconciliationDependencies = {},
): Promise<DirectorFrontierReconciliationResult> {
  const listCandidates = dependencies.listCandidates
    ?? listDirectorFrontierCandidates
  const resume = dependencies.resume ?? defaultResume
  const lockProject = dependencies.lockProject
    ?? ((projectId, operation) =>
      tryProjectFrontierLock(database, projectId, operation))
  const candidates = await listCandidates(database)
  const result: DirectorFrontierReconciliationResult = {
    reconciledProjectIds: [],
    failedProjectIds: [],
    deferredProjectIds: [],
  }

  for (const candidate of candidates) {
    try {
      const resumed = await runInAuthContext(
        {
          workspaceId: candidate.workspaceId,
          userId: SYSTEM_USER_ID,
        },
        () => lockProject(
          candidate.projectId,
          () => resume(candidate.projectId),
        ),
      )
      if (!resumed) {
        result.deferredProjectIds.push(candidate.projectId)
        console.info('[director_frontier_reconcile_deferred]', {
          workspaceId: candidate.workspaceId,
          projectId: candidate.projectId,
          code: 'FRONTIER_LOCK_BUSY',
        })
        continue
      }
      result.reconciledProjectIds.push(candidate.projectId)
      console.info('[director_frontier_reconciled]', {
        workspaceId: candidate.workspaceId,
        projectId: candidate.projectId,
        status: resumed.status,
        enqueuedNodeCount: resumed.enqueuedNodeIds.length,
        repairRootNodeCount: resumed.repairRootNodeIds.length,
        failedNodeCount: resumed.failedNodeIds.length,
        blockedNodeCount: resumed.blockedNodes.length,
      })
    } catch {
      result.failedProjectIds.push(candidate.projectId)
      console.warn('[director_frontier_reconcile_failed]', {
        workspaceId: candidate.workspaceId,
        projectId: candidate.projectId,
        code: 'FRONTIER_RECONCILE_FAILED',
      })
    }
  }
  return result
}

export async function listDirectorFrontierCandidates(
  database: Db,
): Promise<DirectorFrontierCandidate[]> {
  const rows = await database.execute(sql`
    select
      project.workspace_id as "workspaceId",
      project.id as "projectId"
    from projects project
    where project.autopilot = true
      and project.workflow_kind in ('script', 'audio')
      and exists (
        select 1
        from canvas_nodes candidate
        where candidate.workspace_id = project.workspace_id
          and candidate.project_id = project.id
          and candidate.status in ('idle', 'stale')
          and not exists (
            select 1
            from canvas_edges edge
            inner join canvas_nodes upstream
              on upstream.workspace_id = edge.workspace_id
              and upstream.project_id = edge.project_id
              and upstream.id = edge.source
            where edge.workspace_id = candidate.workspace_id
              and edge.project_id = candidate.project_id
              and edge.target = candidate.id
              and upstream.status not in ('succeeded', 'skipped')
          )
      )
      and not exists (
        select 1
        from task_attempts attempt
        inner join pipeline_runs run
          on run.workspace_id = attempt.workspace_id
          and run.id = attempt.run_id
        where attempt.workspace_id = project.workspace_id
          and run.project_id = project.id
          and run.execution_epoch = project.execution_epoch
          and attempt.status in ('queued', 'running')
      )
    order by project.updated_at asc, project.id asc
    limit 25
  `)
  return Array.from(rows, (row) => ({
    workspaceId: String(row.workspaceId),
    projectId: String(row.projectId),
  }))
}

async function defaultResume(projectId: string): Promise<PipelineStartResult> {
  const { startProjectPipeline } = await import('./advance')
  return startProjectPipeline(projectId)
}
