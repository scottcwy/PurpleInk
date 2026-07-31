import 'server-only'

import { and, desc, eq } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import { PRESIGN_TTL_SECONDS, storage } from '@/lib/storage'
import { presignArtifactDownload } from './presign'

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
    eq(artifacts.workspaceId, currentWorkspaceId()),
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

export async function getArtifactDescriptor(
  projectId: string,
  artifactId: string,
): Promise<ArtifactDescriptor | null> {
  const database = await getDb()
  const [row] = await database
    .select({
      id: artifacts.id,
      projectId: artifacts.projectId,
      aggregateType: artifacts.aggregateType,
      aggregateId: artifacts.aggregateId,
      kind: artifacts.kind,
      contentHash: artifacts.contentHash,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, currentWorkspaceId()),
        eq(artifacts.id, artifactId),
        eq(artifacts.projectId, projectId),
      ),
    )
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    projectId: row.projectId,
    nodeId: row.aggregateType === 'node' ? row.aggregateId : null,
    kind: row.kind,
    contentHash: row.contentHash,
  }
}

/** 按 workspace + project + id 取完整产物行；DB 行就是跨 workspace 隔离的守门人。 */
async function findArtifactRow(projectId: string, artifactId: string) {
  const database = await getDb()
  const [row] = await database
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, currentWorkspaceId()),
        eq(artifacts.id, artifactId),
        eq(artifacts.projectId, projectId)
      )
    )
    .limit(1)
  return row ?? null
}

export async function readArtifact(
  projectId: string,
  artifactId: string
): Promise<{ descriptor: ArtifactDescriptor; bytes: Buffer }> {
  const row = await findArtifactRow(projectId, artifactId)
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

/**
 * 解析产物的远端预签名下载 URL。
 * local 模式返回 null（路由继续走字节流）；s3-mirror 模式返回限时 URL 供 302。
 * 认证与交付门控由调用方（路由）先行完成，这里只管 storageKey 到 URL。
 */
export async function getArtifactDownloadRedirect(
  projectId: string,
  artifactId: string,
  options: { attachment: boolean }
): Promise<string | null> {
  const row = await findArtifactRow(projectId, artifactId)
  if (!row) throw new Error('产物不存在或不属于该项目')
  return presignArtifactDownload(storage, {
    storageKey: row.storageKey,
    kind: row.kind,
    contentHash: row.contentHash,
    attachment: options.attachment,
    ttlSeconds: PRESIGN_TTL_SECONDS,
  })
}


