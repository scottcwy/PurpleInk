import type { WebsiteEnginePhase } from '@/features/website/engine-client'
import type { ProceduralSfxManifest } from '@/features/render/procedural-sfx-manifest'
import type {
  WebsiteExecutionFailureCode,
  WebsiteVerificationProjection,
  WebsiteWorkflowPhase,
} from '@/features/website/website-stage-contract'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'
import type {
  WorkflowFaultOrigin,
  WorkflowRecovery,
} from '@/features/canvas/workflow-fault'

export type ProjectExecutionState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'stopping'
  | 'recovering'
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'cancelled'

export type WebsiteStageState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'cancelled'

export type ProjectExecutionFailureCode =
  | WebsiteExecutionFailureCode
  | 'WEBSITE_VERIFICATION_FAILED'
  | 'WEBSITE_STATE_INCONSISTENT'

export interface WebsiteStageSnapshot {
  nodeId: string
  phase: WebsiteWorkflowPhase
  state: WebsiteStageState
  updatedAt: string
  enginePhase?: WebsiteEnginePhase
  durationSec?: number | null
  durationSource?: 'request' | 'output' | null
  elapsedSec?: number | null
  verification?: WebsiteVerificationProjection
  artifact?: {
    artifactId: string
    contentHash: string
    sizeBytes: number
  }
  failureCode?: ProjectExecutionFailureCode
}

export interface WebsiteDeliverySnapshot {
  artifactId: string
  attemptId: string
  lifecycle: 'draft' | 'approved' | 'released' | 'rejected'
  schemaVersion: string
  contentHash: string
  sizeBytes: number
  version: number
  soundEffects?: {
    artifactId: string
    lifecycle: 'draft' | 'approved' | 'released' | 'rejected'
    mode: ProceduralSfxManifest['mode']
    status: ProceduralSfxManifest['status']
    generatorVersion: ProceduralSfxManifest['generatorVersion']
    cueCount: number
    timingHash: string | null
    cuePlanHash: string | null
    waveformHashes: string[]
    failureCode?: ProceduralSfxManifest['failureCode']
  }
  verification?: WebsiteVerificationProjection
  downloadUrl?: string
}

export type ProjectWorkItemState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'skipped'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'stale'

export interface ProjectWorkItemSnapshot {
  nodeId: string
  logicalKey: string
  state: ProjectWorkItemState
  updatedAt: string
}

export interface ShotWorkflowSnapshot {
  shotId: string
  state: ProjectWorkItemState
  steps: ProjectWorkItemSnapshot[]
}

interface DirectorWorkflowDetail {
  director: ProjectWorkItemSnapshot[]
  fanOut: {
    shotCount: number
    completedShotCount: number
    shots: ShotWorkflowSnapshot[]
  }
  merge: ProjectWorkItemSnapshot | null
  export: ProjectWorkItemSnapshot | null
}

export type ProjectExecutionDetail =
  | ({ kind: 'script' } & DirectorWorkflowDetail)
  | ({
      kind: 'audio'
      asr: ProjectWorkItemSnapshot | null
      sourceAudioBound: boolean
    } & DirectorWorkflowDetail)
  | {
      kind: 'website'
      stages: WebsiteStageSnapshot[]
    }

export interface ProjectExecutionFailureSnapshot {
  code: string
  origin?: WorkflowFaultOrigin
  retryable?: boolean
  recovery?: WorkflowRecovery
  referenceId?: string
}

export interface ProjectExecutionRecoverySnapshot {
  canStart: boolean
  canStop: boolean
  mode: 'none' | 'start' | 'stop' | 'automatic' | 'manual'
}

export interface ProjectExecutionSnapshot {
  schemaVersion: 2
  projectKind: ProjectWorkflowKind
  workflowKind: ProjectWorkflowKind
  state: ProjectExecutionState
  active: boolean
  canStart: boolean
  canStop: boolean
  attempt: {
    id: string
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
    updatedAt: string
    failureCode?: ProjectExecutionFailureCode
  } | null
  currentStage: {
    nodeId: string
    phase: WebsiteWorkflowPhase
    updatedAt: string
    enginePhase?: WebsiteEnginePhase
  } | null
  currentWork: ProjectWorkItemSnapshot | null
  failure: ProjectExecutionFailureSnapshot | null
  recovery: ProjectExecutionRecoverySnapshot
  detail: ProjectExecutionDetail
  stages: WebsiteStageSnapshot[]
  delivery: WebsiteDeliverySnapshot | null
  revision: string
}

export interface ProjectExecutionFacts {
  project: {
    id: string
    workflowKind: ProjectWorkflowKind
    autopilot: boolean
    directorContinuationEnabled: boolean
    soundEffects: 'off' | 'procedural'
    subtitles: 'burn-in' | 'off'
  }
  attempt: {
    id: string
    status: string
    leaseExpiresAt: string | null
    cancelRequestedAt: string | null
    updatedAt: string
    failure: unknown
  } | null
  nodes: Array<{
    id: string
    logicalKey: string
    status: string
    updatedAt: string
    data: unknown
  }>
  artifact: {
    id: string
    attemptId: string
    lifecycle: string
    schemaVersion: string
    contentHash: string
    sizeBytes: number
    version: number
    soundEffects: WebsiteDeliverySnapshot['soundEffects'] | null
  } | null
  now: string
}

export class ProjectExecutionSnapshotError extends Error {
  readonly code = 'PROJECT_NOT_FOUND'
  readonly statusCode = 404

  constructor() {
    super('项目不存在')
    this.name = 'ProjectExecutionSnapshotError'
  }
}
