import 'server-only'
import {
  AutomaticAdvanceDisabledError,
  type QueueEnqueueReceipt,
} from '@/lib/queue'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'
import {
  assertNodeExecutionActive,
  type CanvasNodeType,
  type NodeStatus,
} from '@/features/canvas'
import { PIPELINE_STAGES, type PipelineStage } from './types'
import type {
  ExportFinalizationResult,
  ExportFinalizationTrigger,
} from './export-finalization'
import {
  automaticAdvanceDisabled,
  type PipelineResumeExecution,
} from './resume-control'
import {
  createDefaultAdvanceDependencies,
  createDefaultPipelineControlDependencies,
} from './advance-default-dependencies'
import { resumePipelineEntry } from './resume-entry'

export interface AdvanceCandidate {
  id: string
  type: CanvasNodeType
  stage: string | null
  status: NodeStatus
  retryable?: boolean
}

export interface AdvanceRepository {
  isAutomaticAdvanceEnabled(projectId: string): Promise<boolean>
  listDownstreamCandidates(
    projectId: string,
    completedNodeId: string
  ): Promise<AdvanceCandidate[]>
  areAllUpstreamsSuccessful(projectId: string, nodeId: string): Promise<boolean>
  isNodeStale(nodeId: string): Promise<boolean>
  markNodeStale(nodeId: string): Promise<void>
  isMediaReady(projectId: string): Promise<boolean>
  recordStageError(
    nodeId: string,
    stage: PipelineStage,
    error: unknown
  ): Promise<void>
}

export interface PipelineRepository extends AdvanceRepository {
  setAutopilot(projectId: string, enabled: boolean): Promise<boolean>
  getEntryNode(projectId: string): Promise<AdvanceCandidate>
  findActiveAttempt?(projectId: string, nodeId: string): Promise<QueueEnqueueReceipt | null>
  /** 已完成（成功或已跳过）的节点，作为续跑推进的起点。 */
  listCompletedNodeIds(projectId: string): Promise<string[]>
  isProjectComplete?(projectId: string): Promise<boolean>
}

export type EnqueueDirectorStage = (
  input: {
    projectId: string
    nodeId: string
    stage: PipelineStage
  },
  options?: { preservePending?: boolean },
) => Promise<string | QueueEnqueueReceipt>

type EnqueueRenderShot = (
  input: {
    projectId: string
    nodeId: string
  },
  options?: { requireAutomaticAdvance?: boolean },
) => Promise<string>

export interface AdvanceDependencies {
  repository: AdvanceRepository
  enqueueDirectorStage: EnqueueDirectorStage
  enqueueRenderShot: EnqueueRenderShot
  requestExportFinalization(input: {
    projectId: string
    exportNodeId: string
    trigger: ExportFinalizationTrigger
  }): Promise<ExportFinalizationResult>
}

export interface PipelineBlock {
  nodeId: string
  code: string
  message: string
}

export interface AdvanceResult {
  enqueuedNodeIds: string[]
  failedNodeIds: string[]
  blockedNodes?: PipelineBlock[]
}

export interface PipelineStartResult extends AdvanceResult {
  autopilot: true
  status: 'started' | 'reused' | 'blocked' | 'complete'
  jobId?: string
  attemptStatus?: QueueEnqueueReceipt['status']
  reused?: boolean
  repairRootNodeIds: string[]
  blockedNodes: PipelineBlock[]
}

export interface PipelineResumeResult extends AdvanceResult {
  status: 'started' | 'reused' | 'blocked' | 'complete'
  jobId?: string
  attemptStatus?: QueueEnqueueReceipt['status']
  reused?: boolean
  repairRootNodeIds: string[]
  blockedNodes: PipelineBlock[]
}

export interface PipelineControlDependencies {
  repository: PipelineRepository
  enqueueDirectorStage: EnqueueDirectorStage
  advance: (
    projectId: string,
    completedNodeId: string
  ) => Promise<AdvanceResult>
  repairFrontier?: (projectId: string) => Promise<{
    enqueuedNodeIds: string[]
    repairRootNodeIds: string[]
    handledSuccessfulNodeIds: string[]
    blockedNodes: PipelineBlock[]
  }>
  withResumeControl?: (
    projectId: string,
    execution: PipelineResumeExecution | undefined,
    operation: () => Promise<PipelineResumeResult>,
  ) => Promise<PipelineResumeResult | null>
}

/**
 * 一个节点成功后推进其直接下游。
 *
 * 只消费持久化 DAG 与项目 autopilot，不接受客户端提供的下游节点或阶段。
 */
export async function advancePipeline(
  projectId: string,
  completedNodeId: string,
  dependencies?: AdvanceDependencies,
  execution?: { attemptId: string; signal?: AbortSignal },
): Promise<AdvanceResult> {
  await assertExecutionActive()
  const resolved = dependencies ?? (await createDefaultAdvanceDependencies())
  const result: AdvanceResult = { enqueuedNodeIds: [], failedNodeIds: [] }
  if (!(await resolved.repository.isAutomaticAdvanceEnabled(projectId))) return result

  const candidates = await resolved.repository.listDownstreamCandidates(
    projectId,
    completedNodeId
  )
  for (const candidate of candidates) {
    let status = candidate.status
    if (
      status === 'success' &&
      (await resolved.repository.isNodeStale(candidate.id))
    ) {
      await resolved.repository.markNodeStale(candidate.id)
      status = 'stale'
    }
    if (
      !['idle', 'failed', 'stale'].includes(status) ||
      (status === 'failed' && candidate.retryable !== true) ||
      !isPipelineStage(candidate.stage) ||
      !(await resolved.repository.areAllUpstreamsSuccessful(
        projectId,
        candidate.id
      ))
    ) {
      continue
    }
    try {
      await assertExecutionActive()
      if (candidate.type === 'shot-codegen') {
        if (!(await resolved.repository.isMediaReady(projectId))) continue
        await resolved.enqueueRenderShot(
          { projectId, nodeId: candidate.id },
          { requireAutomaticAdvance: true },
        )
      } else if (candidate.type === 'export') {
        const finalization = await resolved.requestExportFinalization({
          projectId,
          exportNodeId: candidate.id,
          trigger: 'autopilot',
        })
        if (finalization.status === 'blocked') {
          const blockedNodes = result.blockedNodes ?? []
          blockedNodes.push({
            nodeId: candidate.id,
            code: finalization.block.code,
            message: finalization.block.message,
          })
          result.blockedNodes = blockedNodes
          continue
        }
      } else {
        await resolved.enqueueDirectorStage({
          projectId,
          nodeId: candidate.id,
          stage: candidate.stage,
        })
      }
      await assertExecutionActive()
      result.enqueuedNodeIds.push(candidate.id)
    } catch (error) {
      if (error instanceof AutomaticAdvanceDisabledError) continue
      result.failedNodeIds.push(candidate.id)
      await resolved.repository.recordStageError(
        candidate.id,
        candidate.stage,
        error
      )
    }
  }
  return result

  async function assertExecutionActive(): Promise<void> {
    execution?.signal?.throwIfAborted()
    if (execution && !dependencies) {
      await assertNodeExecutionActive(completedNodeId, {
        projectId,
        attemptId: execution.attemptId,
        signal: execution.signal,
      })
    }
    execution?.signal?.throwIfAborted()
  }
}

/** 开启项目 autopilot，并从入口或既有成功前沿继续执行。 */
export async function startProjectPipeline(
  projectId: string,
  dependencies?: PipelineControlDependencies
): Promise<PipelineStartResult> {
  if (!dependencies) await assertProjectWorkflowSupported(projectId)
  const resolved = dependencies ?? (
    await createDefaultPipelineControlDependencies(advancePipeline)
  )
  await resolved.repository.setAutopilot(projectId, true)
  return {
    autopilot: true,
    ...(await resumeProjectPipeline(projectId, resolved)),
  }
}

/** 不改写来源专属门闩，只从入口或既有成功前沿恢复 Director。 */
export async function resumeProjectPipeline(
  projectId: string,
  dependencies?: PipelineControlDependencies,
  execution?: PipelineResumeExecution,
): Promise<PipelineResumeResult> {
  if (!dependencies) await assertProjectWorkflowSupported(projectId)
  const resolved = dependencies ?? (
    await createDefaultPipelineControlDependencies(advancePipeline)
  )
  const resume = () => resumeProjectPipelineUnlocked(projectId, resolved)
  const result = resolved.withResumeControl
    ? await resolved.withResumeControl(projectId, execution, resume)
    : await resume()
  return result ?? automaticAdvanceDisabled(projectId)
}

async function resumeProjectPipelineUnlocked(
  projectId: string,
  resolved: PipelineControlDependencies,
): Promise<PipelineResumeResult> {
  const entry = await resolved.repository.getEntryNode(projectId)
  const enqueued = new Set<string>()
  const failed = new Set<string>()
  const repairRoots = new Set<string>()
  const blockedNodes: PipelineResumeResult['blockedNodes'] = []
  const handledSuccessfulNodes = new Set<string>()
  let entryAttempt: QueueEnqueueReceipt | null = null

  if (entry.status === 'success') {
    if (resolved.repairFrontier) {
      const repair = await resolved.repairFrontier(projectId)
      repair.enqueuedNodeIds.forEach((nodeId) => enqueued.add(nodeId))
      repair.repairRootNodeIds.forEach((nodeId) => repairRoots.add(nodeId))
      repair.handledSuccessfulNodeIds.forEach((nodeId) =>
        handledSuccessfulNodes.add(nodeId)
      )
      blockedNodes.push(...repair.blockedNodes)
    }
    for (const completedNodeId of await resolved.repository.listCompletedNodeIds(
      projectId
    )) {
      if (handledSuccessfulNodes.has(completedNodeId)) continue
      const result = await resolved.advance(projectId, completedNodeId)
      result.enqueuedNodeIds.forEach((nodeId) => enqueued.add(nodeId))
      result.failedNodeIds.forEach((nodeId) => failed.add(nodeId))
      blockedNodes.push(...(result.blockedNodes ?? []))
    }
  } else {
    const entryResume = await resumePipelineEntry(
      projectId,
      entry,
      resolved.repository,
      resolved.enqueueDirectorStage,
    )
    entryAttempt = entryResume.attempt
    if (entryResume.enqueued) enqueued.add(entry.id)
  }

  const complete =
    enqueued.size === 0 &&
    failed.size === 0 &&
    blockedNodes.length === 0 &&
    (await resolved.repository.isProjectComplete?.(projectId)) === true
  if (enqueued.size === 0 && !complete && blockedNodes.length === 0) {
    blockedNodes.push({
      nodeId: entry.id,
      code: 'QUEUE_FAILED',
      message: '项目尚未完成，但当前没有可入队节点',
    })
  }
  return {
    status: complete
      ? 'complete'
      : entryAttempt?.reused
        ? 'reused'
        : enqueued.size > 0
          ? 'started'
          : 'blocked',
    ...(entryAttempt
      ? {
          jobId: entryAttempt.attemptId,
          attemptStatus: entryAttempt.status,
          reused: entryAttempt.reused,
        }
      : {}),
    enqueuedNodeIds: [...enqueued],
    repairRootNodeIds: [...repairRoots],
    failedNodeIds: [...failed],
    blockedNodes,
  }
}

function isPipelineStage(stage: string | null): stage is PipelineStage {
  return stage !== null && PIPELINE_STAGES.includes(stage as PipelineStage)
}
