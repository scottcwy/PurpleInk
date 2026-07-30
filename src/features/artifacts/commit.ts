import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  artifacts,
  canvasNodes,
  projects,
} from '@/lib/db/schema/index'
import {
  withTransaction,
  type TransactionContext,
} from '@/lib/db/transaction'
import {
  assertAttemptExists,
  assertAttemptFence,
  type CommitArtifactInput,
} from './attempt-ownership'

export {
  resolveCurrentAttemptId,
  resolveDerivedSourceAttemptId,
  type ArtifactAggregateType,
  type CommitArtifactInput,
  type DerivedSourceLookup,
} from './attempt-ownership'

export async function commitArtifactRecord<T = undefined>(
  database: Db,
  input: CommitArtifactInput,
  updateProjection?: (
    transaction: TransactionContext,
    artifactId: string
  ) => Promise<T>,
  options?: { signal?: AbortSignal },
): Promise<{ artifactId: string; version: number; projection: T | undefined }> {
  return withTransaction(database, async (transaction) => {
    options?.signal?.throwIfAborted()
    await lockAggregate(transaction, input)
    options?.signal?.throwIfAborted()
    await assertAttemptFence(transaction, input)
    options?.signal?.throwIfAborted()
    const committed = await insertArtifactVersion(
      transaction,
      input,
      updateProjection,
    )
    options?.signal?.throwIfAborted()
    return committed
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
