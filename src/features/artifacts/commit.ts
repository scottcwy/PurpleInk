import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, gt, sql } from 'drizzle-orm'
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
  })
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
    .where(
      and(
        eq(taskAttempts.workspaceId, input.workspaceId),
        eq(taskAttempts.id, input.attemptId),
        eq(taskAttempts.entityType, input.aggregateType),
        eq(taskAttempts.entityId, input.aggregateId),
        eq(pipelineRuns.projectId, input.projectId),
        eq(pipelineRuns.status, 'running'),
        eq(taskAttempts.status, 'running')
      )
    )
    .limit(1)
    .for('update')
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
