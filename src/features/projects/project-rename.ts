import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { projects } from '@/lib/db/schema/index'
import { ProjectNotFoundError, ProjectTitleError } from './project-mutation-errors'

/** 与创建时的标题口径一致（project-creation.ts）。 */
const titleSchema = z
  .string()
  .trim()
  .min(1, '标题不能为空')
  .max(200, '标题不能超过 200 字')

export interface RenamedProject {
  id: string
  title: string
}

export interface ProjectRenameDependencies {
  database?: Db
  workspaceId?: string
}

/**
 * 重命名项目。非法标题不写库；项目不存在抛 ProjectNotFoundError。
 * 只动 title 与 updatedAt，不触碰工作流版本、来源或产物。
 */
export async function renameProject(
  projectId: string,
  input: unknown,
  dependencies: ProjectRenameDependencies = {},
): Promise<RenamedProject> {
  const parsed = titleSchema.safeParse(input)
  if (!parsed.success) {
    throw new ProjectTitleError(parsed.error.issues[0]?.message ?? '标题无效')
  }
  const database = dependencies.database ?? (await getDb())
  const workspaceId = dependencies.workspaceId ?? currentWorkspaceId()
  const [updated] = await database
    .update(projects)
    .set({ title: parsed.data, updatedAt: new Date() })
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
    .returning({ id: projects.id, title: projects.title })
  if (!updated) throw new ProjectNotFoundError()
  return updated
}
