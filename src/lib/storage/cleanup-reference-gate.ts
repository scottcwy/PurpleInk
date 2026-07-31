import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { artifacts, projectSources } from '@/lib/db/schema/index'

/** 防止补偿清理删除已经被同 workspace 业务真值引用的对象。 */
export async function isStorageKeyReferenced(
  database: Db,
  workspaceId: string,
  storageKey: string,
): Promise<boolean> {
  const [artifact] = await database
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(
      eq(artifacts.workspaceId, workspaceId),
      eq(artifacts.storageKey, storageKey),
    ))
    .limit(1)
  if (artifact) return true
  const [source] = await database
    .select({ projectId: projectSources.projectId })
    .from(projectSources)
    .where(and(
      eq(projectSources.workspaceId, workspaceId),
      sql`${projectSources.sourcePayload} ->> 'storageKey' = ${storageKey}`,
    ))
    .limit(1)
  return Boolean(source)
}
