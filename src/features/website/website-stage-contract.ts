import type { NodeStatus } from '@/features/canvas'
import type { WebsiteEngineJob, WebsiteEnginePhase } from './engine-client'

export const WEBSITE_WORKFLOW_PHASES = [
  'capture',
  'script',
  'narration',
  'compose',
  'render',
  'export',
] as const

export type WebsiteWorkflowPhase = (typeof WEBSITE_WORKFLOW_PHASES)[number]

export type WebsiteExecutionFailureCode =
  | 'WEBSITE_ENGINE_TIMEOUT'
  | 'WEBSITE_ENGINE_FAILED'
  | 'WEBSITE_ENGINE_UNAVAILABLE'
  | 'WEBSITE_ENGINE_RESPONSE_INVALID'
  | 'WEBSITE_VIDEO_INVALID'
  | 'WEBSITE_PROJECT_INVALID'
  | 'WEBSITE_VERIFICATION_FAILED'
  | 'WEBSITE_EXECUTION_FAILED'

export interface WebsiteVerificationProjection {
  checkPassed: boolean
  goldenVerified: boolean
  goldenCheckCount: number
  outcome: 'passed' | 'degraded'
}

export interface WebsiteStageProgress {
  phase: WebsiteWorkflowPhase
  enginePhase: WebsiteEnginePhase
  state: 'queued' | 'running'
  durationSec: number | null
  durationSource: 'request' | 'output' | null
  elapsedSec: number | null
  verification: WebsiteVerificationProjection | null
}

export interface WebsiteOutputProjection {
  artifactId: string
  contentHash: string
  sizeBytes: number
  durationSec: number | null
  durationSource: 'request' | 'output' | null
  elapsedSec: number | null
  verification: WebsiteVerificationProjection
}

export interface WebsiteStageProjector {
  progress(projectId: string, progress: WebsiteStageProgress): Promise<void>
  complete(projectId: string, output: WebsiteOutputProjection): Promise<void>
  block(projectId: string, output: WebsiteOutputProjection): Promise<void>
  fail(
    projectId: string,
    phase: WebsiteWorkflowPhase,
    code: WebsiteExecutionFailureCode,
  ): Promise<void>
}

export type WebsiteStageTarget =
  | 'reset'
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'

export type PersistedWebsiteNodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'stale'
  | 'skipped'
  | 'blocked'

export function workflowPhaseForEnginePhase(
  phase: WebsiteEnginePhase,
): WebsiteWorkflowPhase {
  if (phase === 'queued' || phase === 'capturing') return 'capture'
  if (phase === 'scripting') return 'script'
  if (phase === 'synthesizing' || phase === 'timing') return 'narration'
  if (phase === 'composing') return 'compose'
  if (phase === 'rendering' || phase === 'verifying') return 'render'
  return 'export'
}

export function safeWebsiteStageProgress(
  job: WebsiteEngineJob,
): WebsiteStageProgress {
  return {
    phase: workflowPhaseForEnginePhase(job.phase),
    enginePhase: job.phase,
    state: job.status === 'queued' ? 'queued' : 'running',
    durationSec: job.durationSec,
    durationSource: job.durationSource,
    elapsedSec: job.elapsedSec,
    verification: websiteVerificationProjection(job),
  }
}

export function websiteVerificationProjection(
  job: Pick<
    WebsiteEngineJob,
    'checkPassed' | 'goldenVerified' | 'goldenCheckCount'
  >,
): WebsiteVerificationProjection | null {
  if (job.checkPassed === null || job.goldenVerified === null) return null
  return {
    checkPassed: job.checkPassed,
    goldenVerified: job.goldenVerified,
    goldenCheckCount: job.goldenCheckCount,
    outcome: job.checkPassed && job.goldenVerified ? 'passed' : 'degraded',
  }
}

export function websiteNodeTransitionPlan(
  current: PersistedWebsiteNodeStatus,
  target: WebsiteStageTarget,
): NodeStatus[] {
  if (target === 'reset') {
    return current === 'succeeded' ? ['stale'] : []
  }
  if (target === 'pending') {
    if (current === 'succeeded') return ['stale', 'pending']
    return ['queued', 'running'].includes(current) ? [] : ['pending']
  }
  if (target === 'running') {
    if (current === 'succeeded') return ['stale', 'pending', 'running']
    if (current === 'running') return []
    if (current === 'queued') return ['running']
    return ['pending', 'running']
  }
  if (target === 'success') {
    if (current === 'succeeded') return []
    if (current === 'running') return ['success']
    if (current === 'queued') return ['running', 'success']
    return ['pending', 'running', 'success']
  }
  if (target === 'failed') {
    if (current === 'failed' || current === 'succeeded') return []
    if (current === 'running') return ['failed']
    if (current === 'queued') return ['running', 'failed']
    return ['pending', 'running', 'failed']
  }
  if (current === 'cancelled' || current === 'succeeded') return []
  if (current === 'queued' || current === 'running') return ['cancelled']
  return ['pending', 'cancelled']
}
