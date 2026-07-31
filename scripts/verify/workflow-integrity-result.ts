import { createHash } from 'node:crypto'

export interface WorkflowIntegrityFinding {
  check: string
  count: number
  blocking?: boolean
}

export interface WorkflowIntegritySummary {
  schemaVersion: 1
  ok: boolean
  checkedAt: string
  referenceId: string
  blockingViolations: number
  advisoryViolations: number
  findings: WorkflowIntegrityFinding[]
}

export function summarizeWorkflowIntegrity(
  findings: WorkflowIntegrityFinding[],
  checkedAt: string,
): WorkflowIntegritySummary {
  const blockingViolations = findings
    .filter(({ blocking = true }) => blocking)
    .reduce((total, finding) => total + finding.count, 0)
  const advisoryViolations = findings
    .filter(({ blocking = true }) => !blocking)
    .reduce((total, finding) => total + finding.count, 0)
  const referenceId = createHash('sha256')
    .update(JSON.stringify({ checkedAt, findings }))
    .digest('hex')
    .slice(0, 12)
  return {
    schemaVersion: 1,
    ok: blockingViolations === 0,
    checkedAt,
    referenceId,
    blockingViolations,
    advisoryViolations,
    findings,
  }
}
