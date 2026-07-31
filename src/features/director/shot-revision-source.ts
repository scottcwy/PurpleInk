import 'server-only'

import { and, desc, eq, ne } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'

/**
 * 读取当前镜头最新可用的完整 FABRICATE HTML，供 AI 做局部修订。
 *
 * rejected 版本已被确定性 / runtime 门禁判坏，不能成为下一版编辑底稿。
 * 大文本只在 worker 执行期读入内存，不进入队列 payload 或公共投影。
 */
export async function loadShotRevisionSource(
  database: Db,
  storage: StorageAdapter,
  projectId: string,
  nodeId: string,
): Promise<string> {
  const [artifact] = await database
    .select({ storageKey: artifacts.storageKey })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, currentWorkspaceId()),
        eq(artifacts.projectId, projectId),
        eq(artifacts.aggregateType, 'node'),
        eq(artifacts.aggregateId, nodeId),
        eq(artifacts.kind, 'director-fabricate'),
        ne(artifacts.lifecycle, 'rejected'),
      ),
    )
    .orderBy(desc(artifacts.version), desc(artifacts.createdAt), desc(artifacts.id))
    .limit(1)
  if (!artifact) {
    throw new Error(`节点缺少可修订的 director-fabricate 产物：${nodeId}`)
  }
  return (await storage.get(artifact.storageKey)).toString('utf-8')
}
