import type { PositionedCanvasNode } from '@/features/canvas'
import type {
  ProjectExecutionSnapshot,
  WebsiteStageSnapshot,
} from '@/features/projects'
export {
  ExecutionSnapshotRevisionGate,
  executionPollDelay,
  SingleFlightExecutionReader,
} from '@/features/projects/execution-sync'

export function applyExecutionSnapshotToNodes(
  nodes: PositionedCanvasNode[],
  snapshot: ProjectExecutionSnapshot,
): PositionedCanvasNode[] {
  if (snapshot.workflowKind !== 'website') return nodes
  const stages = new Map(snapshot.stages.map((stage) => [stage.nodeId, stage]))
  return nodes.map((node) => {
    const stage = stages.get(node.id)
    if (!stage) return node
    return {
      ...node,
      status: canvasStatus(stage.state),
      data: {
        ...node.data,
        websiteExecution: websiteExecutionProjection(stage),
      },
    }
  })
}

function canvasStatus(
  state: WebsiteStageSnapshot['state'],
): PositionedCanvasNode['status'] {
  if (state === 'queued') return 'pending'
  if (state === 'succeeded') return 'success'
  return state
}

function websiteExecutionProjection(
  stage: WebsiteStageSnapshot,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    phase: stage.phase,
    state: stage.state,
    updatedAt: stage.updatedAt,
    ...(stage.enginePhase ? { enginePhase: stage.enginePhase } : {}),
    ...(stage.durationSec !== undefined
      ? { durationSec: stage.durationSec }
      : {}),
    ...(stage.durationSource !== undefined
      ? { durationSource: stage.durationSource }
      : {}),
    ...(stage.elapsedSec !== undefined ? { elapsedSec: stage.elapsedSec } : {}),
    ...(stage.verification ? { verification: stage.verification } : {}),
    ...(stage.artifact ? { artifact: stage.artifact } : {}),
    ...(stage.failureCode ? { failure: { code: stage.failureCode } } : {}),
  }
}
