import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import {
  aiInvocations,
  artifacts,
  pipelineRuns,
  projects,
  taskAttempts,
  workflowConcurrencyLeases,
} from '@/lib/db/schema/index'
import { withTransaction, type TransactionContext } from '@/lib/db/transaction'
import { storage as defaultStorage } from '@/lib/storage'
import type { StorageAdapter } from '@/lib/storage'
import {
  ProjectDeleteBlockedError,
  ProjectNotFoundError,
} from './project-mutation-errors'

/** 在途执行状态：命中任一即拒绝删除。 */
const IN_FLIGHT_ATTEMPT_STATUSES = ['queued', 'running'] as const
const IN_FLIGHT_LEASE_STATUSES = ['waiting', 'active'] as const

/** 谱系分层删除的轮数上限；正常链路远小于此值，超出即视为数据异常。 */
const MAX_LINEAGE_PASSES = 64

export interface ProjectDeletionResult {
  projectId: string
  deletedArtifacts: number
  /** 已从存储移除的产物字节数量；DB 提交后 best-effort 清理。 */
  removedStorageKeys: number
}

export interface ProjectDeletionDependencies {
  database?: Db
  workspaceId?: string
  storage?: Pick<StorageAdapter, 'delete'>
}

/**
 * 物理删除整个项目（不可恢复）。
 *
 * 删除顺序即正确性——级联链上有三条 `ON DELETE RESTRICT` 加一个不可变性触发器，
 * 裸 `DELETE FROM projects` 在有产物谱系或 AI 调用记录的真实项目上会直接报错：
 *
 * 1. `artifacts_immutable_lifecycle_trigger` 拦住 approved / released 产物的删除：
 *    在事务内置 `purpleink.project_purge=on` 声明整项目清除意图（见 migration 0019，
 *    只豁免 DELETE，不豁免 UPDATE）；
 * 2. `ai_invocations.trace_artifact_id → artifacts` RESTRICT：先置空引用而不是删行。
 *    注意：挂在该项目 run / attempt 上的 invocation 会由既有
 *    `ai_invocations_run_fk` / `ai_invocations_attempt_fk` 的 CASCADE 一并消失
 *    （本任务不改这层设计）；置空只为让「未挂该项目 run 却引用了它产物」的
 *    invocation 存活。工作区级用量周期与计费账本不属于项目级联，不受影响；
 * 3. `artifacts.supersedes_artifact_id → artifacts` 自引用 RESTRICT：不能延迟到语句末，
 *    故按谱系分层删除，每轮只删当前无人引用的产物，而不是原地断链；
 * 4. `artifacts.attempt_id → task_attempts` RESTRICT：产物必须早于 attempt 删除，
 *    而 attempt 是 `projects → pipeline_runs → task_attempts` 级联的末端。
 *
 * 其余表（canvas_nodes / canvas_edges / pipeline_runs / task_attempts /
 * workflow_concurrency_leases / project_sources）由 projects 的 CASCADE 收走。
 * 所有语句都锚定 (workspaceId, projectId)，不波及其他项目。
 */
export async function deleteProject(
  projectId: string,
  dependencies: ProjectDeletionDependencies = {},
): Promise<ProjectDeletionResult> {
  const database = dependencies.database ?? (await getDb())
  const workspaceId = dependencies.workspaceId ?? currentWorkspaceId()
  const storageKeys = await withTransaction(database, (transaction) =>
    deleteWithinTransaction(transaction, workspaceId, projectId),
  )
  const removed = await removeStoredBytes(
    dependencies.storage ?? defaultStorage,
    storageKeys,
  )
  return {
    projectId,
    deletedArtifacts: storageKeys.length,
    removedStorageKeys: removed,
  }
}

async function deleteWithinTransaction(
  transaction: TransactionContext,
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  const scope = and(
    eq(projects.workspaceId, workspaceId),
    eq(projects.id, projectId),
  )
  const [existing] = await transaction
    .select({ id: projects.id })
    .from(projects)
    .where(scope)
  if (!existing) throw new ProjectNotFoundError()

  await assertNoInFlightWork(transaction, workspaceId, projectId)

  // 事务级豁免，提交或回滚即失效；不影响并发的其他事务。
  await transaction.execute(
    sql`select set_config('purpleink.project_purge', 'on', true)`,
  )

  const projectArtifacts = await transaction
    .select({ id: artifacts.id, storageKey: artifacts.storageKey })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, workspaceId),
        eq(artifacts.projectId, projectId),
      ),
    )
  const artifactIds = projectArtifacts.map(({ id }) => id)

  if (artifactIds.length > 0) {
    await transaction
      .update(aiInvocations)
      .set({ traceArtifactId: null })
      .where(
        and(
          eq(aiInvocations.workspaceId, workspaceId),
          inArray(aiInvocations.traceArtifactId, artifactIds),
        ),
      )
    await deleteArtifactsByLineage(transaction, workspaceId, projectId)
  }

  await transaction.delete(projects).where(scope)
  return projectArtifacts.map(({ storageKey }) => storageKey)
}

/**
 * 按谱系自下而上删除产物：每轮只删「当前不再被同项目其它产物 supersedes 引用」的行。
 *
 * 自引用外键是 RESTRICT，无法延迟到语句末，所以不能一条 DELETE 清空父子行；
 * 也不用原地把 supersedes 置空——那会构成对已审批产物的就地改写。
 */
async function deleteArtifactsByLineage(
  transaction: TransactionContext,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  for (let pass = 0; pass < MAX_LINEAGE_PASSES; pass += 1) {
    const [remaining] = await transaction
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, workspaceId),
          eq(artifacts.projectId, projectId),
        ),
      )
      .limit(1)
    if (!remaining) return
    await transaction.execute(sql`
      delete from ${artifacts} as leaf
      where leaf.workspace_id = ${workspaceId}
        and leaf.project_id = ${projectId}
        and not exists (
          select 1
          from ${artifacts} as successor
          where successor.workspace_id = leaf.workspace_id
            and successor.project_id = leaf.project_id
            and successor.supersedes_artifact_id = leaf.id
        )
    `)
  }
  throw new Error('产物谱系层数异常，删除未收敛')
}

/** 在途 attempt 或未释放的并发租约都视为「项目正在跑」。 */
async function assertNoInFlightWork(
  transaction: TransactionContext,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const [attempt] = await transaction
    .select({ id: taskAttempts.id })
    .from(taskAttempts)
    .innerJoin(
      pipelineRuns,
      and(
        eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
        eq(pipelineRuns.id, taskAttempts.runId),
      ),
    )
    .where(
      and(
        eq(taskAttempts.workspaceId, workspaceId),
        eq(pipelineRuns.projectId, projectId),
        inArray(taskAttempts.status, [...IN_FLIGHT_ATTEMPT_STATUSES]),
      ),
    )
    .limit(1)
  if (attempt) throw new ProjectDeleteBlockedError()

  const [lease] = await transaction
    .select({ key: workflowConcurrencyLeases.workUnitKey })
    .from(workflowConcurrencyLeases)
    .where(
      and(
        eq(workflowConcurrencyLeases.workspaceId, workspaceId),
        eq(workflowConcurrencyLeases.projectId, projectId),
        inArray(workflowConcurrencyLeases.status, [...IN_FLIGHT_LEASE_STATUSES]),
      ),
    )
    .limit(1)
  if (lease) throw new ProjectDeleteBlockedError()
}

/**
 * 提交后清理产物字节。单个文件失败只跳过：数据库是真值，
 * 孤儿文件不应把已成功的删除翻回失败。
 */
async function removeStoredBytes(
  storage: Pick<StorageAdapter, 'delete'>,
  keys: readonly string[],
): Promise<number> {
  let removed = 0
  for (const key of new Set(keys)) {
    try {
      await storage.delete(key)
      removed += 1
    } catch {
      // 忽略：清理失败不影响已提交的删除结果。
    }
  }
  return removed
}
