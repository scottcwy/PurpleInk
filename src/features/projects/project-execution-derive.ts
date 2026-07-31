import { createHash } from 'node:crypto'
import { finalVideoSchemaVersion } from '@/features/render/final-video-delivery'
import {
  WEBSITE_WORKFLOW_PHASES,
} from '@/features/website/website-stage-contract'
import type {
  ProjectExecutionFacts,
  ProjectExecutionFailureCode,
  ProjectExecutionSnapshot,
  ProjectExecutionState,
  WebsiteDeliverySnapshot,
  WebsiteStageSnapshot,
} from './project-execution-contract'
import {
  currentProjectWork,
  executionDetail,
} from './project-execution-detail'
import {
  isLifecycle,
  optionalDurationSource,
  optionalNumberOrNull,
  record,
  safeArtifact,
  safeEnginePhase,
  safeFailureCode,
  safeFailureProjection,
  safeVerification,
  websiteStageState,
} from './project-execution-safe-projection'

export function deriveProjectExecutionSnapshot(
  facts: ProjectExecutionFacts,
): ProjectExecutionSnapshot {
  const stages = facts.project.workflowKind === 'website'
    ? websiteStages(facts.nodes)
    : []
  const exportStage = stages.find((stage) => stage.phase === 'export')
  const attemptFailure = safeFailureCode(facts.attempt?.failure)
  const delivery = projectDelivery(facts, exportStage)
  const state = executionState(facts, stages, delivery, attemptFailure)
  const failureCode = state === 'blocked' && !attemptFailure
    ? 'WEBSITE_STATE_INCONSISTENT'
    : attemptFailure
  const normalizedAttempt = facts.attempt
    ? {
        id: facts.attempt.id,
        status: publicAttemptStatus(facts.attempt.status),
        updatedAt: facts.attempt.updatedAt,
        ...(failureCode ? { failureCode } : {}),
      }
    : null
  const current = stages.find((stage) =>
    ['queued', 'running', 'blocked', 'failed'].includes(stage.state))
  const detail = executionDetail(facts, stages)
  const currentWork = currentProjectWork(facts, stages)
  const active = ['queued', 'running', 'stopping', 'recovering'].includes(state)
  const canStart = !active && state !== 'succeeded'
  const canStop = active
  const snapshotWithoutRevision = {
    schemaVersion: 2 as const,
    projectKind: facts.project.workflowKind,
    workflowKind: facts.project.workflowKind,
    state,
    active,
    canStart,
    canStop,
    attempt: normalizedAttempt,
    currentStage: current
      ? {
          nodeId: current.nodeId,
          phase: current.phase,
          updatedAt: current.updatedAt,
          ...(current.enginePhase ? { enginePhase: current.enginePhase } : {}),
        }
      : null,
    currentWork,
    failure: safeFailureProjection(facts.attempt?.failure, failureCode),
    recovery: {
      canStart,
      canStop,
      mode: recoveryMode(state),
    },
    detail,
    stages,
    delivery,
  }
  return {
    ...snapshotWithoutRevision,
    revision: createHash('sha256')
      .update(JSON.stringify(snapshotWithoutRevision))
      .digest('hex'),
  }
}

function recoveryMode(
  state: ProjectExecutionState,
): ProjectExecutionSnapshot['recovery']['mode'] {
  if (state === 'stopping' || state === 'queued' || state === 'running') return 'stop'
  if (state === 'recovering') return 'automatic'
  if (state === 'failed' || state === 'blocked' || state === 'cancelled') return 'manual'
  if (state === 'idle') return 'start'
  return 'none'
}

function executionState(
  facts: ProjectExecutionFacts,
  stages: WebsiteStageSnapshot[],
  delivery: WebsiteDeliverySnapshot | null,
  failureCode?: ProjectExecutionFailureCode,
): ProjectExecutionState {
  const attempt = facts.attempt
  if (!attempt) {
    if (isAutomaticContinuationEnabled(facts)) {
      return 'recovering'
    }
    return 'idle'
  }
  if (attempt.status === 'queued') return 'queued'
  if (attempt.status === 'running') {
    if (attempt.cancelRequestedAt) return 'stopping'
    if (
      attempt.leaseExpiresAt
      && Date.parse(attempt.leaseExpiresAt) < Date.parse(facts.now)
    ) {
      return 'recovering'
    }
    return 'running'
  }
  if (attempt.status === 'cancelled' || attempt.status === 'superseded') {
    return 'cancelled'
  }
  if (attempt.status === 'failed') {
    return failureCode === 'WEBSITE_VERIFICATION_FAILED'
      || stages.some((stage) => stage.state === 'blocked')
      ? 'blocked'
      : 'failed'
  }
  if (attempt.status !== 'succeeded') return 'failed'
  if (facts.project.workflowKind !== 'website') {
    const complete = facts.nodes.length > 0
      && facts.nodes.every((node) =>
        node.status === 'succeeded' || node.status === 'skipped')
    if (complete) return 'succeeded'
    return isAutomaticContinuationEnabled(facts) ? 'recovering' : 'idle'
  }
  const passed = stages.length === WEBSITE_WORKFLOW_PHASES.length
    && stages.every((stage) => stage.state === 'succeeded')
    && delivery?.verification?.outcome === 'passed'
    && delivery.lifecycle === 'approved'
    && delivery.attemptId === attempt.id
    && delivery.soundEffects?.lifecycle === 'approved'
    && delivery.soundEffects.mode === facts.project.soundEffects
  return passed ? 'succeeded' : 'blocked'
}

function isAutomaticContinuationEnabled(facts: ProjectExecutionFacts): boolean {
  if (facts.project.workflowKind === 'script') return facts.project.autopilot
  if (facts.project.workflowKind === 'audio') {
    return facts.project.directorContinuationEnabled
  }
  return false
}

function websiteStages(
  nodes: ProjectExecutionFacts['nodes'],
): WebsiteStageSnapshot[] {
  const byKey = new Map(nodes.map((node) => [node.logicalKey, node]))
  return WEBSITE_WORKFLOW_PHASES.flatMap((phase) => {
    const node = byKey.get(`website:${phase}`)
    if (!node) return []
    const projection = record(record(record(node.data).payload).websiteExecution)
    const verification = safeVerification(projection.verification)
    const artifact = safeArtifact(projection.artifact)
    const enginePhase = safeEnginePhase(projection.enginePhase)
    const failureCode = safeFailureCode(projection.failure)
    return [{
      nodeId: node.id,
      phase,
      state: websiteStageState(projection.state, node.status),
      updatedAt: typeof projection.updatedAt === 'string'
        ? projection.updatedAt
        : node.updatedAt,
      ...(enginePhase ? { enginePhase } : {}),
      ...(optionalNumberOrNull(projection.durationSec, 'durationSec')),
      ...(optionalDurationSource(projection.durationSource)),
      ...(optionalNumberOrNull(projection.elapsedSec, 'elapsedSec')),
      ...(verification ? { verification } : {}),
      ...(artifact ? { artifact } : {}),
      ...(failureCode ? { failureCode } : {}),
    }]
  })
}

function projectDelivery(
  facts: ProjectExecutionFacts,
  exportStage?: WebsiteStageSnapshot,
): WebsiteDeliverySnapshot | null {
  const artifact = facts.artifact
  if (!artifact || !isLifecycle(artifact.lifecycle)) return null
  const acceptedLifecycle = artifact.lifecycle === 'approved'
    || (facts.project.workflowKind !== 'website' && artifact.lifecycle === 'released')
  const matchingAudio = artifact.soundEffects?.lifecycle === 'approved'
    && artifact.soundEffects.mode === facts.project.soundEffects
  const matchingDelivery = facts.project.workflowKind === 'website'
    ? exportStage?.verification?.outcome === 'passed'
    : artifact.schemaVersion === finalVideoSchemaVersion(facts.project.subtitles)
  const downloadable = facts.attempt?.status === 'succeeded'
    && acceptedLifecycle
    && matchingAudio
    && matchingDelivery
  return {
    artifactId: artifact.id,
    attemptId: artifact.attemptId,
    lifecycle: artifact.lifecycle,
    schemaVersion: artifact.schemaVersion,
    contentHash: artifact.contentHash,
    sizeBytes: artifact.sizeBytes,
    version: artifact.version,
    ...(artifact.soundEffects
      ? { soundEffects: artifact.soundEffects }
      : {}),
    ...(exportStage?.verification
      ? { verification: exportStage.verification }
      : {}),
    ...(downloadable
      ? {
          downloadUrl:
            `/api/artifacts/${encodeURIComponent(artifact.id)}`
            + `?projectId=${encodeURIComponent(facts.project.id)}`,
        }
      : {}),
  }
}

function publicAttemptStatus(
  status: string,
): NonNullable<ProjectExecutionSnapshot['attempt']>['status'] {
  if (
    status === 'queued'
    || status === 'running'
    || status === 'succeeded'
    || status === 'failed'
  ) {
    return status
  }
  return 'cancelled'
}
