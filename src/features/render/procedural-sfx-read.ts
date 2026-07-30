import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema'
import { storage, type StorageAdapter } from '@/lib/storage'
import {
  readBoundProceduralSfxManifest,
  type ProceduralSfxManifest,
} from './procedural-sfx-manifest'
import type { FinalArtifactRecord } from './render-artifact-repository'

export async function readFinalProceduralSfx(
  projectId: string,
  final: FinalArtifactRecord,
  dependencies: {
    database?: Db
    workspaceId?: string
    storage?: Pick<StorageAdapter, 'get'>
  } = {}
): Promise<ProceduralSfxManifest | null> {
  const database = dependencies.database ?? (await getDb())
  const workspaceId = dependencies.workspaceId ?? currentWorkspaceId()
  const [manifest] = await database
    .select({
      schemaVersion: artifacts.schemaVersion,
      storageKey: artifacts.storageKey,
      contentHash: artifacts.contentHash,
      sizeBytes: artifacts.sizeBytes,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, workspaceId),
        eq(artifacts.projectId, projectId),
        eq(artifacts.aggregateType, 'project'),
        eq(artifacts.aggregateId, projectId),
        eq(artifacts.kind, 'procedural-sfx-manifest'),
        eq(artifacts.attemptId, final.attemptId)
      )
    )
    .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
    .limit(1)
  if (!manifest) return null
  return readBoundProceduralSfxManifest(
    dependencies.storage ?? storage,
    manifest,
    {
      attemptId: final.attemptId,
      finalContentHash: final.contentHash,
    }
  )
}
