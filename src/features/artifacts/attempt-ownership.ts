import 'server-only'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  artifacts,
  pipelineRuns,
  projects,
  taskAttempts,
} from '@/lib/db/schema/index'
import type { TransactionContext } from '@/lib/db/transaction'

export type ArtifactAggregateType = 'node' | 'project'

export interface CommitArtifactInput {
  workspaceId: string
  projectId: string
  aggregateType: ArtifactAggregateType
  aggregateId: string
  kind: string
  schemaVersion: string
  storageKey: string
  sizeBytes: number
  contentHash: string
  attemptId: string
  id?: string
}

interface AttemptLookup {
  workspaceId: string
  projectId: string
  aggregateType: ArtifactAggregateType
  aggregateId: string
}

export async function resolveCurrentAttemptId(
  database: Db,
  input: AttemptLookup
): Promise<string> {
  const [attempt] = await database
    .select({ id: taskAttempts.id })
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
        eq(taskAttempts.workspaceId, input.workspaceId),
        eq(pipelineRuns.projectId, input.projectId),
        eq(pipelineRuns.status, 'running'),
        eq(taskAttempts.entityType, input.aggregateType),
        eq(taskAttempts.entityId, input.aggregateId),
        eq(taskAttempts.status, 'running')
      )
    )
    .orderBy(
      sql`case when ${taskAttempts.status} = 'running' then 0 else 1 end`,
      desc(taskAttempts.attemptNo),
      desc(taskAttempts.updatedAt)
    )
    .limit(1)
  if (!attempt) {
    throw new Error(
      `找不到可归属的 task attempt：${input.projectId}/${input.aggregateId}`
    )
  }
  return attempt.id
}

export interface DerivedSourceLookup {
  workspaceId: string
  projectId: string
  aggregateType: ArtifactAggregateType
  aggregateId: string
  /** 派生所依据的来源产物 kind（如缩略图依据 `director-fabricate` 的 HTML）。 */
  sourceKind: string
}

/**
 * 派生产物的归属锚点：取同一 aggregate 上指定来源 kind 的最新 artifact 的 attemptId。
 *
 * 派生产物（逐帧缩略图等）是对既有 artifact 的确定性再加工，会在产出来源的 attempt
 * 早已结束之后按需生成（分镜页浏览、Final QA），因此不能用「当前 running attempt」
 * 做归属——那个 attempt 属于别的实体，或者根本不存在。用来源产物的 attempt 既保证
 * 血缘真实，也让派生物天然随来源版本走。
 */
export async function resolveDerivedSourceAttemptId(
  database: Db,
  input: DerivedSourceLookup
): Promise<string> {
  const [source] = await database
    .select({ attemptId: artifacts.attemptId })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, input.workspaceId),
        eq(artifacts.projectId, input.projectId),
        eq(artifacts.aggregateType, input.aggregateType),
        eq(artifacts.aggregateId, input.aggregateId),
        eq(artifacts.kind, input.sourceKind)
      )
    )
    .orderBy(desc(artifacts.version), desc(artifacts.id))
    .limit(1)
  if (!source) {
    throw new Error(
      `找不到派生来源产物：${input.projectId}/${input.aggregateId}/${input.sourceKind}`
    )
  }
  return source.attemptId
}

/**
 * 派生产物的最弱归属校验：attemptId 必须真实存在且属于同一项目。
 * 不校验 running 状态与 entityId 一致性——派生物可以晚于来源 attempt 生成，
 * 且可能挂在与来源同一个 aggregate 上（缩略图挂 codegen 节点，而触发方是 QA 节点）。
 */
export async function assertAttemptExists(
  transaction: TransactionContext,
  input: CommitArtifactInput
): Promise<void> {
  const [attempt] = await transaction
    .select({ id: taskAttempts.id })
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
        eq(taskAttempts.workspaceId, input.workspaceId),
        eq(taskAttempts.id, input.attemptId),
        eq(pipelineRuns.projectId, input.projectId)
      )
    )
    .limit(1)
  if (!attempt) {
    throw new Error(
      `派生产物的 attempt 不属于该项目：${input.projectId}/${input.attemptId}`
    )
  }
}

export async function assertAttemptFence(
  transaction: TransactionContext,
  input: CommitArtifactInput
): Promise<void> {
  const [attempt] = await transaction
    .select({
      id: taskAttempts.id,
      runId: taskAttempts.runId,
      taskId: taskAttempts.taskId,
      entityType: taskAttempts.entityType,
      entityId: taskAttempts.entityId,
      attemptNo: taskAttempts.attemptNo,
    })
    .from(taskAttempts)
    .innerJoin(
      pipelineRuns,
      and(
        eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
        eq(pipelineRuns.id, taskAttempts.runId)
      )
    )
    .innerJoin(
      projects,
      and(
        eq(projects.workspaceId, pipelineRuns.workspaceId),
        eq(projects.id, pipelineRuns.projectId)
      )
    )
    .where(
      and(
        eq(taskAttempts.workspaceId, input.workspaceId),
        eq(taskAttempts.id, input.attemptId),
        eq(taskAttempts.entityType, input.aggregateType),
        eq(taskAttempts.entityId, input.aggregateId),
        eq(pipelineRuns.projectId, input.projectId),
        eq(pipelineRuns.status, 'running'),
        eq(taskAttempts.status, 'running'),
        isNull(taskAttempts.cancelRequestedAt),
        eq(pipelineRuns.executionEpoch, projects.executionEpoch)
      )
    )
    .limit(1)
    .for('update', { of: taskAttempts })
  if (!attempt) throw new Error('STALE_ATTEMPT')
  const [newerAttempt] = await transaction
    .select({ id: taskAttempts.id })
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.workspaceId, input.workspaceId),
        eq(taskAttempts.runId, attempt.runId),
        eq(taskAttempts.taskId, attempt.taskId),
        eq(taskAttempts.entityType, attempt.entityType),
        eq(taskAttempts.entityId, attempt.entityId),
        gt(taskAttempts.attemptNo, attempt.attemptNo)
      )
    )
    .orderBy(desc(taskAttempts.attemptNo))
    .limit(1)
    .for('update')
  if (newerAttempt) throw new Error('STALE_ATTEMPT')
}
