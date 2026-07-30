import 'server-only'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  resolvePersistedExportSettings,
} from '@/features/canvas/export-settings'
import { readBoundProceduralSfxManifest } from '@/features/render/procedural-sfx-manifest'
import { getDb, type Db } from '@/lib/db/client'
import {
  artifacts,
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
} from '@/lib/db/schema'
import { storage, type StorageAdapter } from '@/lib/storage'
import { WEBSITE_WORKFLOW_PHASES } from '@/features/website/website-stage-contract'

interface RecoveryArtifactProjection {
  artifactId: string
  contentHash: string
  sizeBytes: number
}

export async function recoverWebsiteDelivery(
  projectId: string,
  dependencies: {
    database?: Db
    workspaceId?: string
    storage?: Pick<StorageAdapter, 'get'>
  } = {},
): Promise<boolean> {
  const database = dependencies.database ?? (await getDb())
  const workspaceId = dependencies.workspaceId ?? currentWorkspaceId()
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${'website-delivery:' + workspaceId + ':' + projectId}, 0)
      )
    `)
    const [project] = await transaction
      .select({
        workflowKind: projects.workflowKind,
        exportSettings: projects.exportSettings,
      })
      .from(projects)
      .where(and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
      ))
      .limit(1)
    if (project?.workflowKind !== 'website') return false
    const requestedSoundEffects =
      resolvePersistedExportSettings(project.exportSettings).soundEffects

    const [attempt] = await transaction
      .select({ id: taskAttempts.id })
      .from(taskAttempts)
      .innerJoin(pipelineRuns, and(
        eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
        eq(pipelineRuns.id, taskAttempts.runId),
      ))
      .where(and(
        eq(taskAttempts.workspaceId, workspaceId),
        eq(pipelineRuns.projectId, projectId),
        eq(taskAttempts.status, 'succeeded'),
      ))
      .orderBy(desc(taskAttempts.createdAt))
      .limit(1)
    if (!attempt) return false

    const nodes = await transaction
      .select({
        logicalKey: canvasNodes.logicalKey,
        status: canvasNodes.status,
        data: canvasNodes.data,
      })
      .from(canvasNodes)
      .where(and(
        eq(canvasNodes.workspaceId, workspaceId),
        eq(canvasNodes.projectId, projectId),
        eq(canvasNodes.type, 'website-stage'),
      ))
    if (!hasSucceededWebsiteStages(nodes)) return false
    const exportNode = nodes.find((node) => node.logicalKey === 'website:export')
    const projectedArtifact = verifiedArtifact(exportNode?.data)
    if (!projectedArtifact) return false

    const [artifact] = await transaction
      .select({
        id: artifacts.id,
        lifecycle: artifacts.lifecycle,
        contentHash: artifacts.contentHash,
        sizeBytes: artifacts.sizeBytes,
      })
      .from(artifacts)
      .where(and(
        eq(artifacts.workspaceId, workspaceId),
        eq(artifacts.projectId, projectId),
        eq(artifacts.attemptId, attempt.id),
        eq(artifacts.kind, 'website-video-mp4'),
        eq(artifacts.id, projectedArtifact.artifactId),
      ))
      .limit(1)
    if (
      !artifact
      || artifact.contentHash !== projectedArtifact.contentHash
      || artifact.sizeBytes !== projectedArtifact.sizeBytes
    ) {
      return false
    }
    const [manifestArtifact] = await transaction
      .select({
        id: artifacts.id,
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
        eq(artifacts.attemptId, attempt.id),
        eq(artifacts.kind, 'procedural-sfx-manifest'),
      ))
      .orderBy(desc(artifacts.version))
      .limit(1)
    if (!manifestArtifact) return false
    const manifest = await readBoundProceduralSfxManifest(
      dependencies.storage ?? storage,
      manifestArtifact,
      {
        attemptId: attempt.id,
        finalContentHash: artifact.contentHash,
      },
    )
    if (!manifest || manifest.mode !== requestedSoundEffects) return false
    if (
      !['draft', 'approved'].includes(artifact.lifecycle)
      || !['draft', 'approved'].includes(manifestArtifact.lifecycle)
    ) {
      return false
    }

    const draftIds = [artifact, manifestArtifact]
      .filter((candidate) => candidate.lifecycle === 'draft')
      .map((candidate) => candidate.id)
    if (draftIds.length > 0) {
      const updated = await transaction
        .update(artifacts)
        .set({ lifecycle: 'approved', updatedAt: new Date() })
        .where(and(
          eq(artifacts.workspaceId, workspaceId),
          eq(artifacts.projectId, projectId),
          inArray(artifacts.id, draftIds),
          eq(artifacts.lifecycle, 'draft'),
        ))
        .returning({ id: artifacts.id })
      if (updated.length !== draftIds.length) {
        throw new Error('网站视频及音效清单 Artifact 恢复不一致')
      }
    }
    return true
  })
}

function hasSucceededWebsiteStages(
  nodes: Array<{ logicalKey: string; status: string }>,
): boolean {
  const byKey = new Map(nodes.map((node) => [node.logicalKey, node.status]))
  return WEBSITE_WORKFLOW_PHASES.every(
    (phase) => byKey.get(`website:${phase}`) === 'succeeded',
  )
}

function verifiedArtifact(data: unknown): RecoveryArtifactProjection | null {
  const execution = record(record(record(data).payload).websiteExecution)
  const verification = record(execution.verification)
  const artifact = record(execution.artifact)
  if (
    execution.state !== 'succeeded'
    || verification.checkPassed !== true
    || verification.goldenVerified !== true
    || typeof artifact.artifactId !== 'string'
    || typeof artifact.contentHash !== 'string'
    || !/^[0-9a-f]{64}$/u.test(artifact.contentHash)
    || typeof artifact.sizeBytes !== 'number'
    || artifact.sizeBytes < 0
  ) {
    return null
  }
  return {
    artifactId: artifact.artifactId,
    contentHash: artifact.contentHash,
    sizeBytes: artifact.sizeBytes,
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
