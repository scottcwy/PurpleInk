import { PIPELINE_STAGES, type PipelineStage, type StageMeta } from './types'

export const STAGE_META: Record<PipelineStage, StageMeta> = {
  INGEST: { id: 'INGEST', title: '导入', description: '文字稿 → script-units + 音频地基' },
  DIRECT: { id: 'DIRECT', title: '导演', description: '风格圣经 + master-plan' },
  SHOT_SPEC: { id: 'SHOT_SPEC', title: '分镜合同', description: '每镜视觉 / 内容合同 shot-plan' },
  FABRICATE: { id: 'FABRICATE', title: '逐镜生产', description: 'AI 生成确定性 HTML + 本机渲染' },
  ASSEMBLE: { id: 'ASSEMBLE', title: '合成', description: '配乐 + 转场 + 拼接' },
  FINALIZE: { id: 'FINALIZE', title: '终稿', description: 'QA 抽帧 + 终渲导出' },
}

/** 有序阶段元数据列表。 */
export const PIPELINE: StageMeta[] = PIPELINE_STAGES.map((stage) => STAGE_META[stage])
