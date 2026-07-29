import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'

export interface Project {
  id: string
  kind: ProjectWorkflowKind
  title: string
  script: string
  createdAt: Date
  updatedAt: Date
}

export type { ProjectWorkflowKind }

export type GlobalCanvasNodeType = 'script-import' | 'shot-split' | 'score' | 'export'

export type ShotLaneNodeType =
  | 'shot-script'
  | 'shot-codegen'
  | 'shot-sfx'
  | 'shot-subtitle'
  | 'shot-qa'

export type CanvasNodeType = GlobalCanvasNodeType | ShotLaneNodeType

export type NodeStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'stale'
  | 'skipped'
  | 'blocked'

export interface CanvasNode {
  id: string
  projectId: string
  type: CanvasNodeType
  stage?: string | null
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface CanvasEdge {
  id: string
  projectId: string
  source: string
  target: string
}
