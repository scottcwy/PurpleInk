import type { transitionNodeStatus } from '@/features/canvas'
import type {
  ArtifactCommitResult,
  WriteArtifactInput,
} from './tools/write-artifact'
import type { createDirectorSession } from './pi-session'
import type { DirectorStageContext } from './runtime-repository'
import type { PreparedStageResult } from './stage-result'
import type { PipelineStage } from './types'

export interface StageRepository {
  loadStageContext(
    projectId: string,
    nodeId: string,
    stage: PipelineStage,
  ): Promise<DirectorStageContext>
  registerArtifactPointer(input: {
    projectId: string
    nodeId: string
    kind: string
    storageKey: string
    attemptId?: string
    signal?: AbortSignal
  }): Promise<string>
  recordStageError(
    nodeId: string,
    stage: PipelineStage,
    error: unknown,
  ): Promise<void>
  recordStageOutput(
    nodeId: string,
    result: PreparedStageResult,
    artifact: ArtifactCommitResult,
    signal?: AbortSignal,
  ): Promise<void>
  persistStreamLog(input: {
    projectId: string
    nodeId: string
    stage: PipelineStage
    text: string
    attemptId?: string
    signal?: AbortSignal
  }): Promise<void>
  shouldResumeCommittedEffect?(
    attemptId: string,
    nodeId: string,
  ): Promise<boolean>
}

export interface StageRunnerDependencies {
  repository: StageRepository
  transitionNodeStatus: typeof transitionNodeStatus
  createSession: typeof createDirectorSession
  buildPrompt: (stage: PipelineStage, context: DirectorStageContext) => string
  writeArtifact: (input: WriteArtifactInput) => Promise<ArtifactCommitResult>
  prepareResult: (
    context: DirectorStageContext,
    rawContent: string,
  ) => PreparedStageResult | Promise<PreparedStageResult>
  commitResult: (
    context: DirectorStageContext,
    result: PreparedStageResult,
    artifact: ArtifactCommitResult,
    signal?: AbortSignal,
  ) => Promise<void>
  runStageEffect: (
    context: DirectorStageContext,
    signal?: AbortSignal,
  ) => Promise<void>
  advancePipeline: (
    projectId: string,
    completedNodeId: string,
    execution?: { attemptId: string; signal?: AbortSignal },
  ) => Promise<unknown>
  scheduleMediaNarration?: (input: {
    projectId: string
    nodeId: string
    attemptId?: string
    signal?: AbortSignal
  }) => Promise<unknown>
}

export type StageRunner = (
  projectId: string,
  nodeId: string,
  stage: PipelineStage,
  attemptId?: string,
  signal?: AbortSignal,
) => Promise<void>
