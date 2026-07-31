import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from './version'

export const PROJECT_WORKFLOW_KINDS = [
  'script',
  'audio',
  'website',
] as const

export type ProjectWorkflowKind = (typeof PROJECT_WORKFLOW_KINDS)[number]

export interface ProjectWorkflowRegistration {
  kind: ProjectWorkflowKind
  activeWorkflowVersion: string
}

const SCRIPT_WORKFLOW_VERSION = serializeWorkflowVersion(
  ACTIVE_WORKFLOW_VERSION
)

export const PROJECT_WORKFLOW_REGISTRY = Object.freeze({
  script: Object.freeze({
    kind: 'script',
    activeWorkflowVersion: SCRIPT_WORKFLOW_VERSION,
  }),
  audio: Object.freeze({
    kind: 'audio',
    activeWorkflowVersion: 'purpleink-audio-to-video-v1',
  }),
  website: Object.freeze({
    kind: 'website',
    activeWorkflowVersion: 'purpleink-website-intro-video-v1',
  }),
} satisfies Record<ProjectWorkflowKind, ProjectWorkflowRegistration>)

export function activeWorkflowVersionFor(
  kind: ProjectWorkflowKind
): string {
  return PROJECT_WORKFLOW_REGISTRY[kind].activeWorkflowVersion
}

export function isActiveProjectWorkflow(
  kind: ProjectWorkflowKind,
  workflowVersion: string
): boolean {
  return workflowVersion === activeWorkflowVersionFor(kind)
}

export function isProjectWorkflowKind(
  value: unknown
): value is ProjectWorkflowKind {
  return (
    typeof value === 'string' &&
    PROJECT_WORKFLOW_KINDS.some((kind) => kind === value)
  )
}
