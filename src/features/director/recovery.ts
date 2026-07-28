import 'server-only'
import {
  getCanvasGraph,
  invalidateNodeForRegeneration,
  setProjectAutopilot,
  type CanvasGraph,
  type CanvasGraphNode,
} from '@/features/canvas'
import { enqueueRenderShot, type RenderShotInput } from '@/features/render'
import { getDb } from '@/lib/db/client'
import { storage } from '@/lib/storage'
import { enqueueDirectorStage, type DirectorStageJobInput } from './queue-handler'
import { DirectorArtifactSource } from './runtime-artifact-source'
import { PIPELINE_STAGES, type PipelineStage } from './types'

export type NodeActionIntent = 'execute' | 'repair' | 'regenerate' | 'rerender'

export interface NodeActionResult {
  ok: true
  action: 'execute' | 'repair-upstream' | 'regenerate' | 'rerender' | 'skip'
  requestedNodeId: string
  queuedNodeId: string
  jobId: string
  message: string
}

export interface NodeRecoveryDependencies {
  getGraph(projectId: string): Promise<CanvasGraph>
  setAutopilot(projectId: string, enabled: boolean): Promise<void>
  inspectShotSpec(
    projectId: string,
    laneKey: string,
    sourceUnitId: string | null
  ): Promise<boolean>
  invalidate(nodeId: string, reason: string): Promise<void>
  enqueueDirectorStage(input: DirectorStageJobInput): Promise<string>
  enqueueRenderShot(input: RenderShotInput): Promise<string>
}

export interface ProjectRepairResult {
  enqueuedNodeIds: string[]
  repairRootNodeIds: string[]
  handledSuccessfulNodeIds: string[]
  blockedNodes: Array<{ nodeId: string; code: string; message: string }>
}

export async function repairProjectFrontier(
  projectId: string,
  dependencies?: NodeRecoveryDependencies
): Promise<ProjectRepairResult> {
  const resolved = dependencies ?? await createDependencies()
  const graph = await resolved.getGraph(projectId)
  const result: ProjectRepairResult = {
    enqueuedNodeIds: [],
    repairRootNodeIds: [],
    handledSuccessfulNodeIds: [],
    blockedNodes: [],
  }
  await resolved.setAutopilot(projectId, true)
  for (const node of graph.nodes) {
    if (node.status !== 'failed' && node.status !== 'stale') {
      continue
    }
    const error = node.directorError ?? node.renderError
    if (node.status === 'failed' && error?.retryable === false) {
      result.blockedNodes.push({
        nodeId: node.id,
        code: error.code ?? 'CONFIGURATION_BLOCKED',
        message: error.message,
      })
      continue
    }
    if (node.type !== 'shot-codegen') continue
    const producer = await findInvalidShotSpecProducer(
      resolved,
      graph,
      projectId,
      node
    )
    if (!producer || result.repairRootNodeIds.includes(producer.id)) continue
    try {
      if (producer.status === 'success') {
        await resolved.invalidate(producer.id, 'repair-upstream')
      }
      await resolved.enqueueDirectorStage({
        projectId,
        nodeId: producer.id,
        stage: 'SHOT_SPEC',
      })
      result.enqueuedNodeIds.push(producer.id)
      result.repairRootNodeIds.push(producer.id)
      result.handledSuccessfulNodeIds.push(producer.id)
    } catch {
      result.blockedNodes.push({
        nodeId: producer.id,
        code: 'QUEUE_FAILED',
        message: '上游镜头合同修复入队失败',
      })
    }
  }
  return result
}

export async function executeNodeAction(
  input: {
    projectId: string
    nodeId: string
    intent: NodeActionIntent
  },
  dependencies?: NodeRecoveryDependencies
): Promise<NodeActionResult> {
  const resolved = dependencies ?? await createDependencies()
  const graph = await resolved.getGraph(input.projectId)
  const requested = findNode(graph, input.nodeId)
  assertActionAllowed(requested)
  await resolved.setAutopilot(input.projectId, true)

  if (input.intent === 'rerender') {
    if (requested.type !== 'shot-codegen') {
      throw new Error('只有镜头代码节点支持重新渲染')
    }
    if (requested.status === 'success') {
      await resolved.invalidate(requested.id, 'manual-regenerate')
    }
    return enqueueRenderResult(resolved, input.projectId, requested, true, 'rerender')
  }

  if (input.intent === 'regenerate') {
    if (requested.status === 'success') {
      await resolved.invalidate(requested.id, 'manual-regenerate')
    }
    return enqueueNode(resolved, input.projectId, requested, 'regenerate')
  }

  if (requested.type === 'shot-codegen') {
    const repairRoot = await findInvalidShotSpecProducer(
      resolved,
      graph,
      input.projectId,
      requested
    )
    if (repairRoot) {
      if (repairRoot.status === 'success') {
        await resolved.invalidate(repairRoot.id, 'repair-upstream')
      }
      const jobId = await resolved.enqueueDirectorStage({
        projectId: input.projectId,
        nodeId: repairRoot.id,
        stage: 'SHOT_SPEC',
      })
      return result(
        'repair-upstream',
        requested.id,
        repairRoot.id,
        jobId,
        `已定位并排队修复上游镜头合同 ${repairRoot.laneKey ?? repairRoot.id}`
      )
    }
  }

  return enqueueNode(resolved, input.projectId, requested, 'execute')
}

async function findInvalidShotSpecProducer(
  dependencies: NodeRecoveryDependencies,
  graph: CanvasGraph,
  projectId: string,
  requested: CanvasGraphNode
): Promise<CanvasGraphNode | null> {
  const producerIds = graph.edges
    .filter((edge) => edge.target === requested.id)
    .map((edge) => edge.source)
  const producer = graph.nodes.find(
    (node) => producerIds.includes(node.id) && node.type === 'shot-script'
  )
  if (!producer?.laneKey) return null
  const sourceUnitId =
    typeof producer.data.sourceUnitId === 'string'
      ? producer.data.sourceUnitId
      : null
  try {
    const valid = await dependencies.inspectShotSpec(
      projectId,
      producer.laneKey,
      sourceUnitId
    )
    return valid ? null : producer
  } catch {
    return producer
  }
}

async function enqueueNode(
  dependencies: NodeRecoveryDependencies,
  projectId: string,
  node: CanvasGraphNode,
  action: 'execute' | 'regenerate'
): Promise<NodeActionResult> {
  if (node.type === 'shot-codegen') {
    return enqueueRenderResult(dependencies, projectId, node, false, action)
  }
  if (!isPipelineStage(node.stage)) {
    throw new Error('当前节点缺少可执行阶段')
  }
  const jobId = await dependencies.enqueueDirectorStage({
    projectId,
    nodeId: node.id,
    stage: node.stage,
  })
  return result(
    action,
    node.id,
    node.id,
    jobId,
    action === 'regenerate' ? '已排队重新生成并更新下游' : '已排队执行此阶段'
  )
}

async function enqueueRenderResult(
  dependencies: NodeRecoveryDependencies,
  projectId: string,
  node: CanvasGraphNode,
  forceRender: boolean,
  action: 'execute' | 'regenerate' | 'rerender'
): Promise<NodeActionResult> {
  const jobId = await dependencies.enqueueRenderShot({
    projectId,
    nodeId: node.id,
    ...(forceRender ? { forceRender: true } : {}),
  })
  return result(
    action,
    node.id,
    node.id,
    jobId,
    action === 'rerender' ? '已绕过缓存排队重新渲染' : '已排队执行此阶段'
  )
}

function assertActionAllowed(node: CanvasGraphNode): void {
  if (node.status === 'pending' || node.status === 'running') {
    throw new Error('当前节点已在排队或执行中')
  }
}

function findNode(graph: CanvasGraph, nodeId: string): CanvasGraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`节点不存在：${nodeId}`)
  return node
}

function result(
  action: NodeActionResult['action'],
  requestedNodeId: string,
  queuedNodeId: string,
  jobId: string,
  message: string
): NodeActionResult {
  return { ok: true, action, requestedNodeId, queuedNodeId, jobId, message }
}

function isPipelineStage(stage: string | null): stage is PipelineStage {
  return stage !== null && PIPELINE_STAGES.includes(stage as PipelineStage)
}

async function createDependencies(): Promise<NodeRecoveryDependencies> {
  const database = await getDb()
  const source = new DirectorArtifactSource(database, storage)
  return {
    getGraph: getCanvasGraph,
    setAutopilot: async (projectId, enabled) => {
      await setProjectAutopilot(projectId, enabled)
    },
    inspectShotSpec: async (projectId, laneKey, sourceUnitId) => {
      const shotPlan = await source.loadShotSpecArtifact(projectId, laneKey)
      if (shotPlan.shots.length !== 1) return false
      const [shot] = shotPlan.shots
      if (!shot || shot.id !== laneKey) return false
      if (!sourceUnitId) return true
      const sourceUnitIds = Array.isArray(shot.sourceUnitIds)
        ? shot.sourceUnitIds
        : []
      const audioBinding =
        shot.audioBinding &&
        typeof shot.audioBinding === 'object' &&
        !Array.isArray(shot.audioBinding)
          ? shot.audioBinding as Record<string, unknown>
          : null
      return (
        sourceUnitIds.length === 1 &&
        sourceUnitIds[0] === sourceUnitId &&
        audioBinding?.unitId === sourceUnitId
      )
    },
    invalidate: invalidateNodeForRegeneration,
    enqueueDirectorStage,
    enqueueRenderShot,
  }
}
