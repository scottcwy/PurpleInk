export interface WorkflowVersionV1 {
  workflow: string
  contracts: string
  compiler: string
  hyperframes: string
  renderImage: string
}

export const ACTIVE_WORKFLOW_VERSION = Object.freeze({
  workflow: 'cvc-v3-foundation',
  contracts: 'cvc-arch-v3.0.0',
  compiler: 'legacy-html-v1',
  hyperframes: 'legacy-cvc-render-v1',
  renderImage: 'node22-playwright1.61.1-ffmpeg-static5.3.0',
} satisfies WorkflowVersionV1)

export function serializeWorkflowVersion(version: WorkflowVersionV1): string {
  return [
    version.workflow,
    version.contracts,
    version.compiler,
    version.hyperframes,
    version.renderImage,
  ].join('|')
}
