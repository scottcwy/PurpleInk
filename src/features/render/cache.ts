import 'server-only'
import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import {
  commitArtifactRecord,
  resolveCurrentAttemptId,
} from '@/features/artifacts'
import { getDb, LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'

export interface RenderCacheEntry {
  outputKey: string
  contentHash: string
}

export interface RenderCacheLookup {
  projectId: string
  nodeId: string
  renderKey: string
}

export interface WriteRenderCacheInput extends RenderCacheEntry {
  projectId: string
  nodeId: string
}

interface CacheDependencies {
  db?: Db
  storage?: StorageAdapter
}

/** 查找仍有实体文件的最新 render-mp4 缓存。 */
export async function lookupCache(
  input: RenderCacheLookup,
  dependencies: CacheDependencies = {}
): Promise<RenderCacheEntry | null> {
  const db = dependencies.db ?? (await getDb())
  const storage = dependencies.storage ?? defaultStorage
  const outputKey = renderOutputKey(input)
  const candidates = await db
    .select({
      storageKey: artifacts.storageKey,
      contentHash: artifacts.contentHash,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.kind, 'render-mp4'),
        eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(artifacts.projectId, input.projectId),
        eq(artifacts.aggregateType, 'node'),
        eq(artifacts.aggregateId, input.nodeId),
        eq(artifacts.storageKey, outputKey)
      )
    )
    .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
  for (const candidate of candidates) {
    if (
      candidate.contentHash &&
      (await storage.exists(candidate.storageKey))
    ) {
      return {
        outputKey: candidate.storageKey,
        contentHash: candidate.contentHash,
      }
    }
  }
  return null
}

export function renderOutputKey(input: RenderCacheLookup): string {
  return `render/${input.projectId}/${input.nodeId}/${input.renderKey}.mp4`
}

/** 登记已由可信 renderer 提交到 StorageAdapter 的内容寻址 mp4。 */
export async function writeCache(
  input: WriteRenderCacheInput,
  dependencies: CacheDependencies = {}
): Promise<string> {
  const database = dependencies.db ?? (await getDb())
  const storage = dependencies.storage ?? defaultStorage
  const bytes = await storage.get(input.outputKey)
  const actualHash = createHash('sha256').update(bytes).digest('hex')
  if (actualHash !== input.contentHash) {
    throw new Error('render cache 实体 hash 与声明不一致')
  }
  const attemptId = await resolveCurrentAttemptId(database, {
    workspaceId: LOCAL_WORKSPACE_ID,
    projectId: input.projectId,
    aggregateType: 'node',
    aggregateId: input.nodeId,
  })
  const committed = await commitArtifactRecord(database, {
    workspaceId: LOCAL_WORKSPACE_ID,
    projectId: input.projectId,
    aggregateType: 'node',
    aggregateId: input.nodeId,
    kind: 'render-mp4',
    schemaVersion: 'cvc.render-cache/v1',
    storageKey: input.outputKey,
    sizeBytes: bytes.byteLength,
    contentHash: actualHash,
    attemptId,
  })
  return committed.artifactId
}
