import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { projects } from '@/lib/db/schema/index'

/**
 * 显式恢复动作只开启项目来源对应的自动推进门闩。
 * website 不使用 Director，因而拒绝进入这个控制面。
 */
export async function enableProjectAutomaticAdvance(
  projectId: string,
  targetDatabase?: Db,
): Promise<void> {
  const database = targetDatabase ?? await getDb()
  await database.transaction(async (transaction) => {
    const [project] = await transaction
      .select({ workflowKind: projects.workflowKind })
      .from(projects)
      .where(and(
        eq(projects.workspaceId, currentWorkspaceId()),
        eq(projects.id, projectId),
        inArray(projects.workflowKind, ['script', 'audio']),
      ))
      .limit(1)
      .for('update')
    if (!project) throw new Error('项目不存在或不支持 Director 自动推进')
    await transaction
      .update(projects)
      .set(project.workflowKind === 'script'
        ? { autopilot: true, updatedAt: new Date() }
        : { directorContinuationEnabled: true, updatedAt: new Date() })
      .where(and(
        eq(projects.workspaceId, currentWorkspaceId()),
        eq(projects.id, projectId),
        eq(projects.workflowKind, project.workflowKind),
      ))
  })
}
