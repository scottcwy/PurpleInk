import { CANONICAL_WORKFLOW_NODES } from './blueprint-model'
import { WorkflowCanvas } from './workflow-canvas'

export function WorkflowCanvasDemo() {
  return (
    <div>
      <p className="mb-3 text-xs text-ds-text-muted">
        Pencil canonical fixture，仅用于视觉回归，不代表真实运行状态。
      </p>
      <WorkflowCanvas nodes={CANONICAL_WORKFLOW_NODES} fixture />
    </div>
  )
}
