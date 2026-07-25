export type {
  CanvasEdge,
  CanvasNode,
  CanvasNodeType,
  GlobalCanvasNodeType,
  NodeStatus,
  Project,
  ShotLaneNodeType,
} from './types'
export {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_RESOLUTION_PRESETS,
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
