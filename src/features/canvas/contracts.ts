export type {
  CanvasEdge,
  CanvasNode,
  CanvasNodeType,
  DirectorCanvasNodeType,
  GlobalCanvasNodeType,
  NodeStatus,
  Project,
  ShotLaneNodeType,
  WorkflowSourceNodeType,
} from './types'
export {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_RESOLUTION_PRESETS,
  MASTER_ASPECT_RATIO,
  MASTER_HEIGHT,
  MASTER_RESOLUTION_PRESET,
  MASTER_WIDTH,
  exportSettingsSchema,
  resolutionForPreset,
  resolveExportSettings,
  type ExportSettings,
  type ResolutionPreset,
} from './export-settings'

export interface ShotLaneSeed {
  shotId: string
  sourceUnit?: {
    unitId: string
    text: string
    order?: number
    speaker?: string
  }
}

export {
  inspectFabricateSource,
  type FabricateSourceInspection,
  type FabricateSourceViolation,
} from './fabricate-source-contract'
export {
  SHOT_REVISION_BRIEF_MAX_LENGTH,
  shotRevisionBriefSchema,
  type ShotRevisionBrief,
} from './shot-revision'
