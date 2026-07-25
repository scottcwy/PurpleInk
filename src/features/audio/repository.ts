import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  commitArtifactRecord,
  resolveCurrentAttemptId as resolveArtifactAttemptId,
} from '@/features/artifacts'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'

const safeSegment = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9._-]+$/, '只能包含字母、数字、点、下划线或连字符')

const storeInputSchema = z
  .object({
    projectId: safeSegment,
    nodeId: safeSegment,
    shotId: safeSegment,
    kind: safeSegment,
    extension: safeSegment,
    data: z.union([z.string(), z.instanceof(Buffer), z.instanceof(Uint8Array)]),
  })
  .strict()

export type StoreAudioArtifactInput = z.input<typeof storeInputSchema>

interface ArtifactIndexRecord {
  id: string
  workspaceId: string
  projectId: string
  aggregateType: 'node'
  aggregateId: string
  kind: string
  lifecycle: 'draft'
  schemaVersion: 'cvc.audio-artifact/v1'
  storageKey: string
  sizeBytes: number
  contentHash: string
  attemptId: string
}

interface StoreDependencies {
  storage: StorageAdapter
  resolveAttemptId: (projectId: string, nodeId: string) => Promise<string>
  insertArtifact: (record: ArtifactIndexRecord) => Promise<void>
  createId: () => string
}

export interface StoredAudioArtifact {
  id: string
  storageKey: string
  contentHash: string
}

/** 音频域可信写服务：先绑定合法 attempt，再落字节并原子登记不可变索引。 */
export async function storeAudioArtifact(
  input: StoreAudioArtifactInput,
  dependencies: StoreDependencies = defaultDependencies()
): Promise<StoredAudioArtifact> {
  const parsed = storeInputSchema.parse(input)
  const attemptId = await dependencies.resolveAttemptId(
    parsed.projectId,
    parsed.nodeId
  )
  const contentHash = createHash('sha256').update(parsed.data).digest('hex')
  const id = dependencies.createId()
  const storageKey =
    `audio/${parsed.projectId}/${parsed.shotId}/` +
    `${parsed.kind}-${contentHash}-${id}.${parsed.extension}`
  await dependencies.storage.put(storageKey, parsed.data)
  try {
    await dependencies.insertArtifact({
      id,
      workspaceId: LOCAL_WORKSPACE_ID,
      projectId: parsed.projectId,
      aggregateType: 'node',
      aggregateId: parsed.nodeId,
      kind: parsed.kind,
      lifecycle: 'draft',
      schemaVersion: 'cvc.audio-artifact/v1',
      storageKey,
      sizeBytes: contentSize(parsed.data),
      contentHash,
      attemptId,
    })
  } catch (error) {
    await dependencies.storage.delete(storageKey)
    throw error
  }
  return { id, storageKey, contentHash }
}

function contentSize(data: string | Buffer | Uint8Array): number {
  return typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
}

function defaultDependencies(): StoreDependencies {
  return {
    storage: defaultStorage,
    createId: randomUUID,
    resolveAttemptId: resolveCurrentAttemptId,
    insertArtifact: async (record) => {
      const database = await getDb()
      await commitArtifactRecord(database, record)
    },
  }
}

async function resolveCurrentAttemptId(
  projectId: string,
  nodeId: string
): Promise<string> {
  const database = await getDb()
  return resolveArtifactAttemptId(database, {
    workspaceId: LOCAL_WORKSPACE_ID,
    projectId,
    aggregateType: 'node',
    aggregateId: nodeId,
  })
}
