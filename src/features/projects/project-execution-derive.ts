import { createHash } from 'node:crypto'
import type { WebsiteEnginePhase } from '@/features/website/engine-client'
import {
  WEBSITE_WORKFLOW_PHASES,
  type WebsiteVerificationProjection,
} from '@/features/website/website-stage-contract'
import type {
  ProjectExecutionFacts,
  ProjectExecutionFailureCode,
  ProjectExecutionSnapshot,
  ProjectExecutionState,
  WebsiteDeliverySnapshot,
  WebsiteStageSnapshot,
  WebsiteStageState,
} from './project-execution-contract'

export function deriveProjectExecutionSnapshot(
  facts: ProjectExecutionFacts,
): ProjectExecutionSnapshot {
  const stages = facts.project.workflowKind === 'website'
    ? websiteStages(facts.nodes)
    : []
  const exportStage = stages.find((stage) => stage.phase === 'export')
  const attemptFailure = safeFailureCode(facts.attempt?.failure)
  const delivery = websiteDelivery(facts, exportStage)
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
  const active = ['queued', 'running', 'stopping', 'recovering'].includes(state)
  const snapshotWithoutRevision = {
    workflowKind: facts.project.workflowKind,
    state,
    active,
    canStart: !active && state !== 'succeeded',
    canStop: active,
    attempt: normalizedAttempt,
    currentStage: current
      ? {
          nodeId: current.nodeId,
          phase: current.phase,
          updatedAt: current.updatedAt,
          ...(current.enginePhase ? { enginePhase: current.enginePhase } : {}),
        }
      : null,
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

function executionState(
  facts: ProjectExecutionFacts,
  stages: WebsiteStageSnapshot[],
  delivery: WebsiteDeliverySnapshot | null,
  failureCode?: ProjectExecutionFailureCode,
): ProjectExecutionState {
  const attempt = facts.attempt
  if (!attempt) {
    if (isAutomaticContinuationEnabled(facts)) {
      return 'running'
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

function websiteDelivery(
  facts: ProjectExecutionFacts,
  exportStage?: WebsiteStageSnapshot,
): WebsiteDeliverySnapshot | null {
  const artifact = facts.artifact
  if (!artifact || !isLifecycle(artifact.lifecycle)) return null
  const downloadable = facts.attempt?.status === 'succeeded'
    && artifact.lifecycle === 'approved'
    && exportStage?.verification?.outcome === 'passed'
    && artifact.soundEffects?.lifecycle === 'approved'
    && artifact.soundEffects.mode === facts.project.soundEffects
  return {
    artifactId: artifact.id,
    attemptId: artifact.attemptId,
    lifecycle: artifact.lifecycle,
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

function websiteStageState(value: unknown, persisted: string): WebsiteStageState {
  if (
    value === 'idle'
    || value === 'queued'
    || value === 'running'
    || value === 'succeeded'
    || value === 'blocked'
    || value === 'failed'
    || value === 'cancelled'
  ) {
    return value
  }
  if (persisted === 'queued') return 'queued'
  if (persisted === 'running') return 'running'
  if (persisted === 'succeeded') return 'succeeded'
  if (persisted === 'failed') return 'failed'
  if (persisted === 'cancelled') return 'cancelled'
  return 'idle'
}

function safeFailureCode(value: unknown): ProjectExecutionFailureCode | undefined {
  const candidate = record(value)
  const code = typeof candidate.failureCode === 'string'
    ? candidate.failureCode
    : typeof candidate.code === 'string'
      ? candidate.code
      : undefined
  return code && [
    'WEBSITE_ENGINE_TIMEOUT',
    'WEBSITE_ENGINE_FAILED',
    'WEBSITE_ENGINE_UNAVAILABLE',
    'WEBSITE_ENGINE_RESPONSE_INVALID',
    'WEBSITE_VIDEO_INVALID',
    'WEBSITE_PROJECT_INVALID',
    'WEBSITE_EXECUTION_FAILED',
    'WEBSITE_VERIFICATION_FAILED',
    'WEBSITE_STATE_INCONSISTENT',
  ].includes(code)
    ? code as ProjectExecutionFailureCode
    : undefined
}

function safeVerification(value: unknown): WebsiteVerificationProjection | undefined {
  const candidate = record(value)
  if (
    typeof candidate.checkPassed !== 'boolean'
    || typeof candidate.goldenVerified !== 'boolean'
    || typeof candidate.goldenCheckCount !== 'number'
    || !Number.isInteger(candidate.goldenCheckCount)
  ) {
    return undefined
  }
  return {
    checkPassed: candidate.checkPassed,
    goldenVerified: candidate.goldenVerified,
    goldenCheckCount: candidate.goldenCheckCount,
    outcome: candidate.checkPassed && candidate.goldenVerified
      ? 'passed'
      : 'degraded',
  }
}

function safeArtifact(value: unknown): WebsiteStageSnapshot['artifact'] | undefined {
  const candidate = record(value)
  if (
    typeof candidate.artifactId !== 'string'
    || typeof candidate.contentHash !== 'string'
    || !/^[0-9a-f]{64}$/u.test(candidate.contentHash)
    || typeof candidate.sizeBytes !== 'number'
    || candidate.sizeBytes < 0
  ) {
    return undefined
  }
  return {
    artifactId: candidate.artifactId,
    contentHash: candidate.contentHash,
    sizeBytes: candidate.sizeBytes,
  }
}

function safeEnginePhase(value: unknown): WebsiteEnginePhase | undefined {
  return typeof value === 'string' && [
    'queued',
    'capturing',
    'scripting',
    'synthesizing',
    'timing',
    'composing',
    'rendering',
    'verifying',
    'muxing',
    'done',
    'failed',
    'cancelled',
  ].includes(value)
    ? value as WebsiteEnginePhase
    : undefined
}

function optionalNumberOrNull(
  value: unknown,
  key: 'durationSec' | 'elapsedSec',
): Partial<Pick<WebsiteStageSnapshot, 'durationSec' | 'elapsedSec'>> {
  return value === null || (typeof value === 'number' && value >= 0)
    ? { [key]: value }
    : {}
}

function optionalDurationSource(
  value: unknown,
): Pick<WebsiteStageSnapshot, 'durationSource'> | Record<string, never> {
  return value === null || value === 'request' || value === 'output'
    ? { durationSource: value }
    : {}
}

function isLifecycle(
  value: string,
): value is WebsiteDeliverySnapshot['lifecycle'] {
  return ['draft', 'approved', 'released', 'rejected'].includes(value)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
