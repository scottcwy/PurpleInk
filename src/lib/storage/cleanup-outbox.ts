import 'server-only'
import { and, asc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, type Db } from '@/lib/db/client'
import {
  STORAGE_CLEANUP_REASONS,
  storageCleanupRequests,
} from '@/lib/db/schema/index'
import { withTransaction } from '@/lib/db/transaction'
import { isStorageKeyReferenced } from './cleanup-reference-gate'
import type { StorageAdapter } from './types'

const safeFailureCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
const cleanupRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  storageKey: z.string().min(1).max(1_024),
  projectId: z.string().uuid().optional(),
  nodeId: z.string().uuid().optional(),
  attemptId: z.string().uuid().optional(),
  reason: z.enum(STORAGE_CLEANUP_REASONS),
  failureCode: safeFailureCodeSchema.optional(),
})
const drainInputSchema = z.object({
  workspaceId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(25),
})
const globalDrainInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
})
const exactDrainInputSchema = z.object({
  workspaceId: z.string().uuid(),
  storageKey: z.string().min(1).max(1_024),
})

export type StorageCleanupRequest = z.infer<typeof cleanupRequestSchema>

export async function enqueueStorageCleanupRequest(
  input: StorageCleanupRequest,
  dependencies: { database?: Db } = {},
): Promise<void> {
  const request = cleanupRequestSchema.parse(input)
  const database = dependencies.database ?? (await getDb())
  await database
    .insert(storageCleanupRequests)
    .values(request)
    .onConflictDoUpdate({
      target: [
        storageCleanupRequests.workspaceId,
        storageCleanupRequests.storageKey,
      ],
      set: {
        projectId: request.projectId ?? null,
        nodeId: request.nodeId ?? null,
        attemptId: request.attemptId ?? null,
        reason: request.reason,
        failureCode: request.failureCode ?? null,
        generation: sql`${storageCleanupRequests.generation} + 1`,
        nextAttemptAt: sql`
          greatest(${storageCleanupRequests.nextAttemptAt}, now())
        `,
        updatedAt: new Date(),
      },
    })
}

export async function drainStorageCleanupRequests(
  input: { workspaceId: string; limit?: number },
  dependencies: {
    database?: Db
    storage: Pick<StorageAdapter, 'delete'>
  },
): Promise<{ claimed: number; deleted: number; deferred: number }> {
  const request = drainInputSchema.parse(input)
  const database = dependencies.database ?? (await getDb())
  const claimed = await claimDueRequests(database, request)
  return settleClaimedRequests(claimed, database, dependencies.storage)
}

export async function drainAllStorageCleanupRequests(
  input: { limit?: number } = {},
  dependencies: {
    database?: Db
    storage: Pick<StorageAdapter, 'delete'>
  },
): Promise<{ claimed: number; deleted: number; deferred: number }> {
  const request = globalDrainInputSchema.parse(input)
  const database = dependencies.database ?? (await getDb())
  const claimed = await claimDueRequests(database, request)
  return settleClaimedRequests(claimed, database, dependencies.storage)
}

export async function drainStorageCleanupRequest(
  input: { workspaceId: string; storageKey: string },
  dependencies: {
    database?: Db
    storage: Pick<StorageAdapter, 'delete'>
  },
): Promise<{ claimed: number; deleted: number; deferred: number }> {
  const request = exactDrainInputSchema.parse(input)
  const database = dependencies.database ?? (await getDb())
  const claimed = await claimDueRequests(database, {
    workspaceId: request.workspaceId,
    storageKey: request.storageKey,
    limit: 1,
  })
  return settleClaimedRequests(claimed, database, dependencies.storage)
}

async function settleClaimedRequests(
  claimed: Awaited<ReturnType<typeof claimDueRequests>>,
  database: Db,
  storage: Pick<StorageAdapter, 'delete'>,
): Promise<{ claimed: number; deleted: number; deferred: number }> {
  let deleted = 0
  let deferred = 0
  for (const item of claimed) {
    let referenced: boolean
    try {
      referenced = await isStorageKeyReferenced(
        database,
        item.workspaceId,
        item.storageKey,
      )
    } catch {
      deferred += await deferClaim(
        database,
        item,
        'STORAGE_REFERENCE_CHECK_FAILED',
      )
      continue
    }
    if (referenced) {
      await settleClaim(database, item)
      continue
    }
    try {
      await storage.delete(item.storageKey)
      deleted += await settleClaim(database, item)
    } catch {
      deferred += await deferClaim(database, item, 'STORAGE_DELETE_FAILED')
    }
  }
  return { claimed: claimed.length, deleted, deferred }
}

async function settleClaim(
  database: Db,
  item: ClaimedCleanupRequest,
): Promise<number> {
  const settled = await database
    .delete(storageCleanupRequests)
    .where(claimIdentity(item))
    .returning({ storageKey: storageCleanupRequests.storageKey })
  return settled.length
}

async function deferClaim(
  database: Db,
  item: ClaimedCleanupRequest,
  failureCode: 'STORAGE_DELETE_FAILED' | 'STORAGE_REFERENCE_CHECK_FAILED',
): Promise<number> {
  const settled = await database
    .update(storageCleanupRequests)
    .set({
      failureCode,
      nextAttemptAt: retryAt(item.attemptCount),
      updatedAt: new Date(),
    })
    .where(claimIdentity(item))
    .returning({ storageKey: storageCleanupRequests.storageKey })
  return settled.length
}

type ClaimedCleanupRequest = Awaited<
  ReturnType<typeof claimDueRequests>
>[number]

function claimIdentity(item: ClaimedCleanupRequest) {
  return and(
    eq(storageCleanupRequests.workspaceId, item.workspaceId),
    eq(storageCleanupRequests.storageKey, item.storageKey),
    eq(storageCleanupRequests.generation, item.generation),
    eq(storageCleanupRequests.attemptCount, item.attemptCount),
  )
}

async function claimDueRequests(
  database: Db,
  input: { workspaceId?: string; storageKey?: string; limit: number },
) {
  return withTransaction(database, async (transaction) => {
    const due = await transaction
      .select({
        workspaceId: storageCleanupRequests.workspaceId,
        storageKey: storageCleanupRequests.storageKey,
        generation: storageCleanupRequests.generation,
        attemptCount: storageCleanupRequests.attemptCount,
      })
      .from(storageCleanupRequests)
      .where(and(
        input.workspaceId
          ? eq(storageCleanupRequests.workspaceId, input.workspaceId)
          : undefined,
        sql`${storageCleanupRequests.nextAttemptAt} <= now()`,
        input.storageKey
          ? eq(storageCleanupRequests.storageKey, input.storageKey)
          : undefined,
      ))
      .orderBy(
        asc(storageCleanupRequests.nextAttemptAt),
        asc(storageCleanupRequests.createdAt),
        asc(storageCleanupRequests.workspaceId),
        asc(storageCleanupRequests.storageKey),
      )
      .limit(input.limit)
      .for('update', { skipLocked: true })
    if (due.length === 0) return []
    await transaction
      .update(storageCleanupRequests)
      .set({
        attemptCount: sql`${storageCleanupRequests.attemptCount} + 1`,
        failureCode: null,
        nextAttemptAt: sql`now() + interval '5 minutes'`,
        updatedAt: new Date(),
      })
      .where(or(...due.map((item) => and(
        eq(storageCleanupRequests.workspaceId, item.workspaceId),
        eq(storageCleanupRequests.storageKey, item.storageKey),
        eq(storageCleanupRequests.generation, item.generation),
        eq(storageCleanupRequests.attemptCount, item.attemptCount),
      ))))
    return due.map((item) => ({
      ...item,
      attemptCount: item.attemptCount + 1,
    }))
  })
}

function retryAt(attemptCount: number) {
  const delayMs = Math.min(30 * 60_000, 2 ** Math.min(attemptCount, 10) * 1_000)
  return sql`now() + (${delayMs} * interval '1 millisecond')`
}
