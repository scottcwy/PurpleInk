import 'server-only'
import { and, eq } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { projects } from '@/lib/db/schema/index'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from '@/lib/workflow/version'

export type ProjectCompatibility = 'supported' | 'legacy'
export type ProjectRouteState = ProjectCompatibility | 'missing'

const SUPPORTED_WORKFLOW_VERSION = serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION)

export class UnsupportedProjectWorkflowError extends Error {
  readonly code = 'UNSUPPORTED_PROJECT_WORKFLOW'

  constructor(readonly projectId: string) {
    super('旧版项目暂不可用，数据已保留')
    this.name = 'UnsupportedProjectWorkflowError'
  }
}

export async function getProjectRouteState(
  projectId: string
): Promise<ProjectRouteState> {
  const database = await getDb()
  const [row] = await database
    .select({ workflowVersion: projects.workflowVersion })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, currentWorkspaceId()),
        eq(projects.id, projectId)
      )
    )
  if (!row) return 'missing'
  return row.workflowVersion === SUPPORTED_WORKFLOW_VERSION ? 'supported' : 'legacy'
}

export async function assertProjectWorkflowSupported(
  projectId: string
): Promise<void> {
  const state = await getProjectRouteState(projectId)
  if (state === 'legacy') throw new UnsupportedProjectWorkflowError(projectId)
  if (state === 'missing') throw new Error(`项目不存在：${projectId}`)
}
