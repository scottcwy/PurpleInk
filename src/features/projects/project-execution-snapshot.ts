import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import {
  artifacts,
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
} from '@/lib/db/schema'
import {
  ProjectExecutionSnapshotError,
  type ProjectExecutionFacts,
  type ProjectExecutionSnapshot,
} from './project-execution-contract'
import { deriveProjectExecutionSnapshot } from './project-execution-derive'

export { ProjectExecutionSnapshotError } from './project-execution-contract'
export type {
  ProjectExecutionFacts,
  ProjectExecutionFailureCode,
  ProjectExecutionSnapshot,
  ProjectExecutionState,
  WebsiteDeliverySnapshot,
  WebsiteStageSnapshot,
  WebsiteStageState,
} from './project-execution-contract'
export { deriveProjectExecutionSnapshot } from './project-execution-derive'

export async function getProjectExecutionSnapshot(
  projectId: string,
  dependencies: {
    database?: Db
    workspaceId?: string
    now?: Date
  } = {},
): Promise<ProjectExecutionSnapshot> {
  const database = dependencies.database ?? (await getDb())
  const workspaceId = dependencies.workspaceId ?? currentWorkspaceId()
  const [project] = await database
    .select({
      id: projects.id,
      workflowKind: projects.workflowKind,
      autopilot: projects.autopilot,
    })
    .from(projects)
    .where(and(
      eq(projects.workspaceId, workspaceId),
      eq(projects.id, projectId),
    ))
    .limit(1)
  if (!project) throw new ProjectExecutionSnapshotError()

  const [nodeRows, attemptRows] = await Promise.all([
    database
      .select({
        id: canvasNodes.id,
        logicalKey: canvasNodes.logicalKey,
        status: canvasNodes.status,
        updatedAt: canvasNodes.updatedAt,
        data: canvasNodes.data,
      })
      .from(canvasNodes)
      .where(and(
        eq(canvasNodes.workspaceId, workspaceId),
        eq(canvasNodes.projectId, projectId),
      )),
    database
      .select({
        id: taskAttempts.id,
        status: taskAttempts.status,
        leaseExpiresAt: taskAttempts.leaseExpiresAt,
        cancelRequestedAt: taskAttempts.cancelRequestedAt,
        updatedAt: taskAttempts.updatedAt,
        failure: taskAttempts.failure,
      })
      .from(taskAttempts)
      .innerJoin(pipelineRuns, and(
        eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
        eq(pipelineRuns.id, taskAttempts.runId),
      ))
      .where(and(
        eq(taskAttempts.workspaceId, workspaceId),
        eq(pipelineRuns.projectId, projectId),
      ))
      .orderBy(desc(taskAttempts.createdAt))
      .limit(1),
  ])
  const attempt = attemptRows[0] ?? null
  const artifact = await findAttemptArtifact(
    database,
    workspaceId,
    projectId,
    attempt?.id,
  )
  const facts: ProjectExecutionFacts = {
    project,
    attempt: attempt
      ? {
          ...attempt,
          leaseExpiresAt: attempt.leaseExpiresAt?.toISOString() ?? null,
          cancelRequestedAt: attempt.cancelRequestedAt?.toISOString() ?? null,
          updatedAt: attempt.updatedAt.toISOString(),
        }
      : null,
    nodes: nodeRows.map((node) => ({
      ...node,
      updatedAt: node.updatedAt.toISOString(),
    })),
    artifact,
    now: (dependencies.now ?? new Date()).toISOString(),
  }
  return deriveProjectExecutionSnapshot(facts)
}

async function findAttemptArtifact(
  database: Db,
  workspaceId: string,
  projectId: string,
  attemptId?: string,
): Promise<ProjectExecutionFacts['artifact']> {
  if (!attemptId) return null
  const [artifact] = await database
    .select({
      id: artifacts.id,
      attemptId: artifacts.attemptId,
      lifecycle: artifacts.lifecycle,
      contentHash: artifacts.contentHash,
      sizeBytes: artifacts.sizeBytes,
      version: artifacts.version,
    })
    .from(artifacts)
    .where(and(
      eq(artifacts.workspaceId, workspaceId),
      eq(artifacts.projectId, projectId),
      eq(artifacts.attemptId, attemptId),
      eq(artifacts.kind, 'website-video-mp4'),
    ))
    .orderBy(desc(artifacts.version))
    .limit(1)
  return artifact ?? null
}
