import 'server-only'
import {
  getCanvasGraph,
  transitionNodeStatus,
  type CanvasGraph,
  type WorkflowBlock,
} from '@/features/canvas'
import {
  enqueueProjectExport,
  type ExportProjectInput,
} from '@/features/render/export-queue-handler'
import { getExportReadiness } from '@/features/render/export-service'

export type ExportFinalizationTrigger =
  | 'autopilot'
  | 'manual-node'
  | 'confirmed-degraded'

export interface ExportFinalizationReadiness {
  ready: boolean
  degradedReady: boolean
  confirmationFingerprint: string | null
  finalArtifactId: string | null
  incompleteNodeIds?: string[]
  blockingIssues?: unknown[]
}

export interface ExportFinalizationDependencies {
  getGraph(projectId: string): Promise<CanvasGraph>
  getReadiness(projectId: string): Promise<ExportFinalizationReadiness>
  transitionNodeStatus: typeof transitionNodeStatus
  enqueueProjectExport(input: ExportProjectInput): Promise<string>
  now(): Date
  referenceId(): string
}

export type ExportFinalizationResult =
  | { status: 'blocked'; nodeId: string; block: WorkflowBlock }
  | {
      status: 'queued'
      nodeId: string
      jobId: string
      mode: 'complete' | 'degraded'
    }

export async function requestExportFinalization(
  input: {
    projectId: string
    exportNodeId?: string
    trigger: ExportFinalizationTrigger
    confirmationFingerprint?: string
  },
  dependencies: ExportFinalizationDependencies = defaultDependencies(),
): Promise<ExportFinalizationResult> {
  const [graph, readiness] = await Promise.all([
    dependencies.getGraph(input.projectId),
    dependencies.getReadiness(input.projectId),
  ])
  const node = resolveExportNode(graph, input.exportNodeId)

  if (!readiness.ready) {
    if (!readiness.degradedReady || !readiness.confirmationFingerprint) {
      throw new ExportFinalizationNotReadyError({
        incompleteNodeIds: readiness.incompleteNodeIds ?? [],
        blockingIssues: readiness.blockingIssues ?? [],
      })
    }
    if (input.trigger !== 'confirmed-degraded') {
      const block = confirmationBlock(readiness.confirmationFingerprint, dependencies)
      if (
        node.status !== 'blocked'
        || node.workflowBlock?.confirmationFingerprint !== block.confirmationFingerprint
      ) {
        await dependencies.transitionNodeStatus(node.id, 'blocked', {
          workflowBlock: block,
        })
      }
      return { status: 'blocked', nodeId: node.id, block }
    }
    if (input.confirmationFingerprint !== readiness.confirmationFingerprint) {
      throw new StaleDegradedConfirmationError()
    }
    const jobId = await dependencies.enqueueProjectExport({
      projectId: input.projectId,
      degraded: true,
      exportNodeId: node.id,
      confirmationFingerprint: readiness.confirmationFingerprint,
    })
    await dependencies.transitionNodeStatus(node.id, 'pending')
    return { status: 'queued', nodeId: node.id, jobId, mode: 'degraded' }
  }

  const jobId = await dependencies.enqueueProjectExport({
    projectId: input.projectId,
    exportNodeId: node.id,
  })
  await dependencies.transitionNodeStatus(node.id, 'pending')
  return { status: 'queued', nodeId: node.id, jobId, mode: 'complete' }
}

export class StaleDegradedConfirmationError extends Error {
  override readonly name = 'StaleDegradedConfirmationError'

  constructor() {
    super('导出范围已变化，请刷新后重新确认降级交付')
  }
}

export class ExportFinalizationNotReadyError extends Error {
  override readonly name = 'ExportFinalizationNotReadyError'

  constructor(readonly safeDetails: {
    incompleteNodeIds: string[]
    blockingIssues: unknown[]
  } = { incompleteNodeIds: [], blockingIssues: [] }) {
    super('项目尚未满足终片导出条件')
  }
}

function resolveExportNode(graph: CanvasGraph, requestedId?: string) {
  const node = graph.nodes.find((candidate) =>
    candidate.type === 'export'
    && (requestedId === undefined || candidate.id === requestedId)
  )
  if (!node) throw new ExportFinalizationNotReadyError()
  return node
}

function confirmationBlock(
  confirmationFingerprint: string,
  dependencies: Pick<ExportFinalizationDependencies, 'now' | 'referenceId'>,
): WorkflowBlock {
  return {
    code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
    message: '当前终片需要使用占位镜头，请确认降级交付。',
    recovery: 'confirm_degraded_export',
    referenceId: dependencies.referenceId(),
    blockedAt: dependencies.now().toISOString(),
    confirmationFingerprint,
  }
}

function defaultDependencies(): ExportFinalizationDependencies {
  return {
    getGraph: getCanvasGraph,
    getReadiness: getExportReadiness,
    transitionNodeStatus,
    enqueueProjectExport,
    now: () => new Date(),
    referenceId: () => globalThis.crypto.randomUUID(),
  }
}
