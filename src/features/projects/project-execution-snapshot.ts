import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import {
  readBoundProceduralSfxManifest,
} from '@/features/render/procedural-sfx-manifest'
import {
  resolvePersistedExportSettings,
} from '@/features/canvas/export-settings'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import {
  artifacts,
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
} from '@/lib/db/schema'
import { storage, type StorageAdapter } from '@/lib/storage'
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
    storage?: Pick<StorageAdapter, 'get'>
  } = {},
): Promise<ProjectExecutionSnapshot> {
  const database = dependencies.database ?? (await getDb())
  const workspaceId = dependencies.workspaceId ?? currentWorkspaceId()
  const [project] = await database
    .select({
      id: projects.id,
      workflowKind: projects.workflowKind,
      autopilot: projects.autopilot,
      directorContinuationEnabled: projects.directorContinuationEnabled,
      exportSettings: projects.exportSettings,
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
    dependencies.storage ?? storage,
  )
  const facts: ProjectExecutionFacts = {
    project: {
      id: project.id,
      workflowKind: project.workflowKind,
      autopilot: project.autopilot,
      directorContinuationEnabled: project.directorContinuationEnabled,
      soundEffects:
        resolvePersistedExportSettings(project.exportSettings).soundEffects,
    },
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
  targetStorage: Pick<StorageAdapter, 'get'> = storage,
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
  if (!artifact) return null
  const [manifestArtifact] = await database
    .select({
      id: artifacts.id,
      attemptId: artifacts.attemptId,
      lifecycle: artifacts.lifecycle,
      schemaVersion: artifacts.schemaVersion,
      storageKey: artifacts.storageKey,
      contentHash: artifacts.contentHash,
      sizeBytes: artifacts.sizeBytes,
    })
    .from(artifacts)
    .where(and(
      eq(artifacts.workspaceId, workspaceId),
      eq(artifacts.projectId, projectId),
      eq(artifacts.attemptId, attemptId),
      eq(artifacts.kind, 'procedural-sfx-manifest'),
    ))
    .orderBy(desc(artifacts.version))
    .limit(1)
  const soundEffects = manifestArtifact
    ? await readBoundSoundEffects(
        targetStorage,
        manifestArtifact,
        {
          attemptId,
          finalContentHash: artifact.contentHash,
        },
      )
    : null
  return { ...artifact, soundEffects }
}

async function readBoundSoundEffects(
  targetStorage: Pick<StorageAdapter, 'get'>,
  artifact: {
    id: string
    lifecycle: string
    schemaVersion: string
    storageKey: string
    contentHash: string
    sizeBytes: number
  },
  expected: { attemptId: string; finalContentHash: string },
): Promise<NonNullable<ProjectExecutionFacts['artifact']>['soundEffects']> {
  if (
    artifact.schemaVersion !== 'cvc.procedural-sfx-manifest/v1'
    || !isManifestLifecycle(artifact.lifecycle)
  ) {
    return null
  }
  try {
    const manifest = await readBoundProceduralSfxManifest(
      targetStorage,
      artifact,
      expected,
    )
    if (!manifest) return null
    return {
      artifactId: artifact.id,
      lifecycle: artifact.lifecycle,
      mode: manifest.mode,
      status: manifest.status,
      generatorVersion: manifest.generatorVersion,
      cueCount: manifest.cueCount,
      timingHash: manifest.timingHash,
      cuePlanHash: manifest.cuePlanHash,
      waveformHashes: manifest.waveformHashes,
      ...(manifest.failureCode ? { failureCode: manifest.failureCode } : {}),
    }
  } catch {
    return null
  }
}

function isManifestLifecycle(
  value: string,
): value is NonNullable<
  NonNullable<ProjectExecutionFacts['artifact']>['soundEffects']
>['lifecycle'] {
  return ['draft', 'approved', 'released', 'rejected'].includes(value)
}
