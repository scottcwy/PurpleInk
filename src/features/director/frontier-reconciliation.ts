import 'server-only'
import { sql } from 'drizzle-orm'
import {
  runInAuthContext,
  SYSTEM_USER_ID,
} from '@/lib/auth/workspace-context'
import type { Db } from '@/lib/db/client'
import type { PipelineResumeResult } from './advance'
import { tryProjectFrontierLock } from './frontier-lock'

export interface DirectorFrontierCandidate {
  workspaceId: string
  projectId: string
}

/** 只自动恢复近期进程中断；更早的历史项目必须由用户显式重新启动。 */
export const DIRECTOR_FRONTIER_RECOVERY_WINDOW_MS = 15 * 60 * 1_000
/** 每轮只恢复最新项目，避免一次启动唤醒一批历史工作流。 */
export const DIRECTOR_FRONTIER_RECOVERY_LIMIT = 1

interface ReconciliationDependencies {
  listCandidates?: (database: Db) => Promise<DirectorFrontierCandidate[]>
  resume?: (projectId: string) => Promise<PipelineResumeResult>
  lockProject?: (
    projectId: string,
    operation: () => Promise<PipelineResumeResult>,
  ) => Promise<PipelineResumeResult | null>
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
    if (
      result.reconciledProjectIds.length >= DIRECTOR_FRONTIER_RECOVERY_LIMIT
    ) {
      break
    }
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
      if (!madePersistedProgress(resumed)) {
        result.deferredProjectIds.push(candidate.projectId)
        console.info('[director_frontier_reconcile_deferred]', {
          workspaceId: candidate.workspaceId,
          projectId: candidate.projectId,
          code: 'FRONTIER_NO_PROGRESS',
          status: resumed.status,
          blockedNodeCount: resumed.blockedNodes.length,
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

/**
 * status/blockedNodes 只是本次扫描的诊断投影，不能证明持久化前沿已经前移。
 * 只有真实入队、上游修复或节点失败落库才消耗本轮恢复配额。
 */
function madePersistedProgress(result: PipelineResumeResult): boolean {
  return result.enqueuedNodeIds.length > 0
    || result.repairRootNodeIds.length > 0
    || result.failedNodeIds.length > 0
}

export async function listDirectorFrontierCandidates(
  database: Db,
): Promise<DirectorFrontierCandidate[]> {
  const rows = await database.execute(sql`
    select
      project.workspace_id as "workspaceId",
      project.id as "projectId"
    from projects project
    cross join lateral (
      select max(source.updated_at) as activity_at
      from (
        select node_activity.updated_at
        from canvas_nodes node_activity
        where node_activity.workspace_id = project.workspace_id
          and node_activity.project_id = project.id
        union all
        select attempt_activity.updated_at
        from task_attempts attempt_activity
        inner join pipeline_runs run_activity
          on run_activity.workspace_id = attempt_activity.workspace_id
          and run_activity.id = attempt_activity.run_id
        where attempt_activity.workspace_id = project.workspace_id
          and run_activity.project_id = project.id
          and run_activity.execution_epoch = project.execution_epoch
      ) source
    ) activity
    where (
      (project.workflow_kind = 'script' and project.autopilot = true)
      or (
        project.workflow_kind = 'audio'
        and project.director_continuation_enabled = true
      )
    )
      and activity.activity_at >=
        now() - (${DIRECTOR_FRONTIER_RECOVERY_WINDOW_MS} * interval '1 millisecond')
      and exists (
        select 1
        from canvas_nodes candidate
        where candidate.workspace_id = project.workspace_id
          and candidate.project_id = project.id
          and (
            candidate.status in ('idle', 'stale')
            or (
              candidate.status = 'failed'
              and case
                when candidate.data #> '{payload,directorError}' is not null
                  and candidate.data #> '{payload,directorError}' <> 'null'::jsonb
                  then candidate.data #> '{payload,directorError,retryable}'
                    = 'true'::jsonb
                when candidate.data #> '{payload,renderError}' is not null
                  and candidate.data #> '{payload,renderError}' <> 'null'::jsonb
                  then candidate.data #> '{payload,renderError,retryable}'
                    = 'true'::jsonb
                else false
              end
            )
          )
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
    order by activity.activity_at desc, project.id desc
  `)
  return Array.from(rows, (row) => ({
    workspaceId: String(row.workspaceId),
    projectId: String(row.projectId),
  }))
}

async function defaultResume(projectId: string): Promise<PipelineResumeResult> {
  const { resumeProjectPipeline } = await import('./advance')
  return resumeProjectPipeline(projectId)
}
