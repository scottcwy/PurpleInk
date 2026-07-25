import 'server-only'

import { and, desc, eq } from 'drizzle-orm'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import { storage } from '@/lib/storage'

export interface ArtifactDescriptor {
  id: string
  projectId: string
  nodeId: string | null
  kind: string
  contentHash: string | null
}

export async function getLatestArtifact(
  projectId: string,
  nodeId: string | null,
  kind: string
): Promise<ArtifactDescriptor | null> {
  const database = await getDb()
  const aggregateType = nodeId === null ? 'project' : 'node'
  const aggregateId = nodeId ?? projectId
  const predicates = [
    eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
    eq(artifacts.projectId, projectId),
    eq(artifacts.aggregateType, aggregateType),
    eq(artifacts.aggregateId, aggregateId),
    eq(artifacts.kind, kind),
  ]
  const [row] = await database
    .select({
      id: artifacts.id,
      projectId: artifacts.projectId,
      kind: artifacts.kind,
      contentHash: artifacts.contentHash,
    })
    .from(artifacts)
    .where(and(...predicates))
    .orderBy(desc(artifacts.version), desc(artifacts.createdAt), desc(artifacts.id))
    .limit(1)
  return row ? { ...row, nodeId } : null
}

export async function readArtifact(
  projectId: string,
  artifactId: string
): Promise<{ descriptor: ArtifactDescriptor; bytes: Buffer }> {
  const database = await getDb()
  const [row] = await database
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(artifacts.id, artifactId),
        eq(artifacts.projectId, projectId)
      )
    )
    .limit(1)
  if (!row) throw new Error('产物不存在或不属于该项目')
  return {
    descriptor: {
      id: row.id,
      projectId: row.projectId,
      nodeId: row.aggregateType === 'node' ? row.aggregateId : null,
      kind: row.kind,
      contentHash: row.contentHash,
    },
    bytes: await storage.get(row.storageKey),
  }
}

export function artifactContentType(kind: string): string {
  if (kind.endsWith('mp4')) return 'video/mp4'
  if (kind === 'voiceover-audio') return 'audio/mpeg'
  if (kind === 'director-fabricate') return 'text/html; charset=utf-8'
  if (kind === 'frame-thumbnail') return 'image/png'
  if (
    kind.includes('json') ||
    kind === 'director-shot-spec' ||
    kind === 'voiceover-metadata' ||
    kind === 'subtitle-track' ||
    kind === 'qa-vision-report'
  ) {
    return 'application/json; charset=utf-8'
  }
  return 'application/octet-stream'
}
