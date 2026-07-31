import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'

const degradedDeliverySchema = z.object({
  finalContentHash: z.string().length(64),
  placeholderLanes: z.array(z.string()),
  waivedQaLanes: z.array(z.string()).optional(),
})

export type FinalExportDelivery = {
  storageKey: string
  delivery:
    | { mode: 'complete' }
    | {
        mode: 'degraded'
        placeholderLanes: string[]
        waivedQaLanes: string[]
      }
}

export async function loadFinalExportDelivery(
  db: Db,
  storage: StorageAdapter,
  projectId: string
): Promise<FinalExportDelivery> {
  const [artifact] = await db
    .select({
      storageKey: artifacts.storageKey,
      contentHash: artifacts.contentHash,
    })
    .from(artifacts)
    .where(and(
      eq(artifacts.workspaceId, currentWorkspaceId()),
      eq(artifacts.projectId, projectId),
      eq(artifacts.aggregateType, 'project'),
      eq(artifacts.aggregateId, projectId),
      eq(artifacts.kind, 'final-mp4')
    ))
    .orderBy(desc(artifacts.version), desc(artifacts.id))
    .limit(1)
  if (!artifact) throw new FinalArtifactNotReadyError()
  const [manifest] = await db
    .select({ storageKey: artifacts.storageKey })
    .from(artifacts)
    .where(and(
      eq(artifacts.workspaceId, currentWorkspaceId()),
      eq(artifacts.projectId, projectId),
      eq(artifacts.aggregateType, 'project'),
      eq(artifacts.aggregateId, projectId),
      eq(artifacts.kind, 'final-mp4-degraded-manifest')
    ))
    .orderBy(desc(artifacts.version), desc(artifacts.id))
    .limit(1)
  if (manifest) {
    try {
      const parsed = degradedDeliverySchema.parse(
        JSON.parse((await storage.get(manifest.storageKey)).toString('utf-8'))
      )
      if (parsed.finalContentHash === artifact.contentHash) {
        return {
          storageKey: artifact.storageKey,
          delivery: {
            mode: 'degraded',
            placeholderLanes: parsed.placeholderLanes,
            waivedQaLanes: parsed.waivedQaLanes ?? [],
          },
        }
      }
    } catch {
      // 损坏或跨版本清单不能改变当前 final-mp4 的交付标记。
    }
  }
  return { storageKey: artifact.storageKey, delivery: { mode: 'complete' } }
}

export class FinalArtifactNotReadyError extends Error {
  override readonly name = 'FinalArtifactNotReadyError'

  constructor() {
    super('请先完成合成导出：项目尚无 final-mp4 产物')
  }
}
