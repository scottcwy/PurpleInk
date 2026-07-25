import 'server-only'
import { getDb } from '@/lib/db/client'
import type { CanvasNodeType, NodeStatus } from '@/features/canvas'
import { AdvanceRepositoryImpl } from './advance-repository'
import { PIPELINE_STAGES, type PipelineStage } from './types'

export interface AdvanceCandidate {
  id: string
  type: CanvasNodeType
  stage: string | null
  status: NodeStatus
}

export interface AdvanceRepository {
  isAutopilotEnabled(projectId: string): Promise<boolean>
  listDownstreamCandidates(
    projectId: string,
    completedNodeId: string
  ): Promise<AdvanceCandidate[]>
  areAllUpstreamsSuccessful(projectId: string, nodeId: string): Promise<boolean>
  recordStageError(
    nodeId: string,
    stage: PipelineStage,
    error: unknown
  ): Promise<void>
}

export interface PipelineRepository extends AdvanceRepository {
  setAutopilot(projectId: string, enabled: boolean): Promise<boolean>
  getEntryNode(projectId: string): Promise<AdvanceCandidate>
  listSuccessfulNodeIds(projectId: string): Promise<string[]>
}

type EnqueueDirectorStage = (input: {
  projectId: string
  nodeId: string
  stage: PipelineStage
}) => Promise<string>

type EnqueueRenderShot = (input: {
  projectId: string
  nodeId: string
}) => Promise<string>

export interface AdvanceDependencies {
  repository: AdvanceRepository
  enqueueDirectorStage: EnqueueDirectorStage
  enqueueRenderShot: EnqueueRenderShot
  prepareFinalExport: (projectId: string) => Promise<void>
}

export interface AdvanceResult {
  enqueuedNodeIds: string[]
  failedNodeIds: string[]
}

export interface PipelineStartResult extends AdvanceResult {
  autopilot: true
}

interface PipelineControlDependencies {
  repository: PipelineRepository
  enqueueDirectorStage: EnqueueDirectorStage
  advance: (
    projectId: string,
    completedNodeId: string
  ) => Promise<AdvanceResult>
}

/**
 * 一个节点成功后推进其直接下游。
 *
 * 只消费持久化 DAG 与项目 autopilot，不接受客户端提供的下游节点或阶段。
 */
export async function advancePipeline(
  projectId: string,
  completedNodeId: string,
  dependencies?: AdvanceDependencies
): Promise<AdvanceResult> {
  const resolved = dependencies ?? (await createDefaultDependencies())
  const result: AdvanceResult = { enqueuedNodeIds: [], failedNodeIds: [] }
  if (!(await resolved.repository.isAutopilotEnabled(projectId))) return result

  const candidates = await resolved.repository.listDownstreamCandidates(
    projectId,
    completedNodeId
  )
  for (const candidate of candidates) {
    if (
      candidate.status !== 'idle' ||
      !isPipelineStage(candidate.stage) ||
      !(await resolved.repository.areAllUpstreamsSuccessful(
        projectId,
        candidate.id
      ))
    ) {
      continue
    }
    try {
      if (candidate.type === 'shot-codegen') {
        await resolved.enqueueRenderShot({ projectId, nodeId: candidate.id })
      } else {
        if (candidate.type === 'export') {
          await resolved.prepareFinalExport(projectId)
        }
        await resolved.enqueueDirectorStage({
          projectId,
          nodeId: candidate.id,
          stage: candidate.stage,
        })
      }
      result.enqueuedNodeIds.push(candidate.id)
    } catch (error) {
      result.failedNodeIds.push(candidate.id)
      await resolved.repository.recordStageError(
        candidate.id,
        candidate.stage,
        error
      )
    }
  }
  return result
}

/** 开启项目 autopilot，并从入口或既有成功前沿继续执行。 */
export async function startProjectPipeline(
  projectId: string,
  dependencies?: PipelineControlDependencies
): Promise<PipelineStartResult> {
  const resolved = dependencies ?? (await createDefaultControlDependencies())
  await resolved.repository.setAutopilot(projectId, true)
  const entry = await resolved.repository.getEntryNode(projectId)
  const enqueued = new Set<string>()
  const failed = new Set<string>()

  if (entry.status === 'success') {
    for (const completedNodeId of await resolved.repository.listSuccessfulNodeIds(
      projectId
    )) {
      const result = await resolved.advance(projectId, completedNodeId)
      result.enqueuedNodeIds.forEach((nodeId) => enqueued.add(nodeId))
      result.failedNodeIds.forEach((nodeId) => failed.add(nodeId))
    }
  } else if (['idle', 'failed', 'stale'].includes(entry.status)) {
    if (entry.stage !== 'INGEST') {
      throw new Error(`项目入口节点阶段无效：${entry.stage ?? 'null'}`)
    }
    await resolved.enqueueDirectorStage({
      projectId,
      nodeId: entry.id,
      stage: 'INGEST',
    })
    enqueued.add(entry.id)
  }

  return {
    autopilot: true,
    enqueuedNodeIds: [...enqueued],
    failedNodeIds: [...failed],
  }
}

/** 关闭后续自动推进；已经入队的作业不会被伪装为已取消。 */
export async function stopProjectPipeline(
  projectId: string
): Promise<{ autopilot: false }> {
  const database = await getDb()
  await new AdvanceRepositoryImpl(database).setAutopilot(projectId, false)
  return { autopilot: false }
}

async function createDefaultDependencies(): Promise<AdvanceDependencies> {
  const [{ enqueueDirectorStage }, { enqueueRenderShot }] = await Promise.all([
    import('./queue-handler'),
    import('@/features/render/queue-handler'),
  ])
  return {
    repository: new AdvanceRepositoryImpl(await getDb()),
    enqueueDirectorStage,
    enqueueRenderShot,
    prepareFinalExport: async (projectId) => {
      const { exportProject } = await import('@/features/render/export-service')
      const result = await exportProject(projectId)
      if (!result.ok) {
        throw new Error(
          `终片导出前置未完成：${result.incompleteNodeIds.join(', ')}`
        )
      }
    },
  }
}

async function createDefaultControlDependencies(): Promise<PipelineControlDependencies> {
  const advanceDependencies = await createDefaultDependencies()
  const repository = advanceDependencies.repository as PipelineRepository
  return {
    repository,
    enqueueDirectorStage: advanceDependencies.enqueueDirectorStage,
    advance: (projectId, completedNodeId) =>
      advancePipeline(projectId, completedNodeId, advanceDependencies),
  }
}

function isPipelineStage(stage: string | null): stage is PipelineStage {
  return stage !== null && PIPELINE_STAGES.includes(stage as PipelineStage)
}
