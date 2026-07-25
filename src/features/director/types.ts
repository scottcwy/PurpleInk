/** 应用层收敛后的 video-director 六阶段。 */
export const PIPELINE_STAGES = [
  'INGEST',
  'DIRECT',
  'SHOT_SPEC',
  'FABRICATE',
  'ASSEMBLE',
  'FINALIZE',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export interface StageMeta {
  id: PipelineStage
  title: string
  description: string
}
