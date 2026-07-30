import type { ProjectExecutionSnapshot } from './project-execution-contract'

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
