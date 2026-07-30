import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  artifacts,
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
} from '@/lib/db/schema/index'
import {
  withTransaction,
  type TransactionContext,
} from '@/lib/db/transaction'

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

export async function commitArtifactRecord<T = undefined>(
  database: Db,
  input: CommitArtifactInput,
  updateProjection?: (
    transaction: TransactionContext,
    artifactId: string
  ) => Promise<T>
): Promise<{ artifactId: string; version: number; projection: T | undefined }> {
  return withTransaction(database, async (transaction) => {
    await lockAggregate(transaction, input)
    await assertAttemptFence(transaction, input)
    return insertArtifactVersion(transaction, input, updateProjection)
  })
}

/**
 * 同一阶段一次产生多个互相引用的产物时使用。所有记录共享一个数据库事务；
 * 任一 attempt 栅栏或版本登记失败，整批回滚，避免只留下半套交付合同。
 */
export async function commitArtifactRecords(
  database: Db,
  inputs: readonly CommitArtifactInput[]
): Promise<Array<{ artifactId: string; version: number }>> {
  if (inputs.length === 0) throw new Error('批量 Artifact 提交不能为空')
  return withTransaction(database, async (transaction) => {
    const committed: Array<{ artifactId: string; version: number }> = []
    for (const input of inputs) {
      await lockAggregate(transaction, input)
      await assertAttemptFence(transaction, input)
      const result = await insertArtifactVersion(transaction, input)
      committed.push({
        artifactId: result.artifactId,
        version: result.version,
      })
    }
    return committed
  })
}

/**
 * 提交派生产物。与 `commitArtifactRecord` 的唯一差别是不做 running attempt 门禁：
 * `attemptId` 必须是本项目内真实存在的 attempt（血缘可追溯），但不要求它仍在运行。
 *
 * 只允许用于「由既有 artifact 确定性再加工得到」的产物；阶段输出一律走
 * `commitArtifactRecord`，门禁不得绕过。
 */
export async function commitDerivedArtifact<T = undefined>(
  database: Db,
  input: CommitArtifactInput,
  updateProjection?: (
    transaction: TransactionContext,
    artifactId: string
  ) => Promise<T>
): Promise<{ artifactId: string; version: number; projection: T | undefined }> {
  return withTransaction(database, async (transaction) => {
    await lockAggregate(transaction, input)
    await assertAttemptExists(transaction, input)
    return insertArtifactVersion(transaction, input, updateProjection)
  })
}

async function insertArtifactVersion<T>(
  transaction: TransactionContext,
  input: CommitArtifactInput,
  updateProjection?: (
    transaction: TransactionContext,
    artifactId: string
  ) => Promise<T>
): Promise<{ artifactId: string; version: number; projection: T | undefined }> {
  const [previous] = await transaction
    .select({ id: artifacts.id, version: artifacts.version })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, input.workspaceId),
        eq(artifacts.aggregateType, input.aggregateType),
        eq(artifacts.aggregateId, input.aggregateId),
        eq(artifacts.kind, input.kind)
      )
    )
    .orderBy(desc(artifacts.version), desc(artifacts.id))
    .limit(1)
    .for('update')
  const artifactId = input.id ?? randomUUID()
  const version = (previous?.version ?? 0) + 1
  await transaction.insert(artifacts).values({
    ...input,
    id: artifactId,
    version,
    lifecycle: 'draft',
    supersedesArtifactId: previous?.id,
  })
  const projection = updateProjection
    ? await updateProjection(transaction, artifactId)
    : undefined
  return { artifactId, version, projection }
}

async function lockAggregate(
  transaction: TransactionContext,
  input: CommitArtifactInput
): Promise<void> {
  if (input.aggregateType === 'node') {
    const [node] = await transaction
      .select({ id: canvasNodes.id })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, input.workspaceId),
          eq(canvasNodes.projectId, input.projectId),
          eq(canvasNodes.id, input.aggregateId)
        )
      )
      .limit(1)
      .for('update')
    if (!node) throw new Error('artifact aggregate node 不存在')
    return
  }
  const [project] = await transaction
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.id, input.projectId),
        eq(projects.id, input.aggregateId)
      )
    )
    .limit(1)
    .for('update')
  if (!project) throw new Error('artifact aggregate project 不存在')
}

/**
 * 派生产物的最弱归属校验：attemptId 必须真实存在且属于同一项目。
 * 不校验 running 状态与 entityId 一致性——派生物可以晚于来源 attempt 生成，
 * 且可能挂在与来源同一个 aggregate 上（缩略图挂 codegen 节点，而触发方是 QA 节点）。
 */
async function assertAttemptExists(
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

async function assertAttemptFence(
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
        eq(projects.id, pipelineRuns.projectId),
      ),
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
        eq(pipelineRuns.executionEpoch, projects.executionEpoch),
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
