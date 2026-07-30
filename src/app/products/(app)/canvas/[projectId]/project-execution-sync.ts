import type { PositionedCanvasNode } from '@/features/canvas'
import type {
  ProjectExecutionSnapshot,
  WebsiteStageSnapshot,
} from '@/features/projects'

const POLL_DELAYS_MS = [1_500, 3_000, 5_000] as const

export function executionPollDelay(
  active: boolean,
  consecutiveFailures: number,
): number | null {
  if (!active) return null
  return POLL_DELAYS_MS[
    Math.min(
      Math.max(consecutiveFailures - 1, 0),
      POLL_DELAYS_MS.length - 1,
    )
  ]
}

export class SingleFlightExecutionReader {
  private inFlight: Promise<ProjectExecutionSnapshot> | null = null

  read(
    loader: () => Promise<ProjectExecutionSnapshot>,
  ): Promise<ProjectExecutionSnapshot> {
    if (this.inFlight) return this.inFlight
    const request = loader().finally(() => {
      if (this.inFlight === request) this.inFlight = null
    })
    this.inFlight = request
    return request
  }
}

export class ExecutionSnapshotRevisionGate {
  private sequence = 0
  private acceptedSequence = 0

  beginRequest(): number {
    this.sequence += 1
    return this.sequence
  }

  supersedePendingRequests(): void {
    this.sequence += 1
    this.acceptedSequence = this.sequence
  }

  shouldAccept(
    requestSequence: number,
    currentRevision: string,
    incomingRevision: string,
  ): boolean {
    if (requestSequence < this.acceptedSequence) return false
    this.acceptedSequence = requestSequence
    return currentRevision !== incomingRevision
  }
}

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
