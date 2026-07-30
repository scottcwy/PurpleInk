import type { CanvasGraphNode } from '@/features/canvas'

/** 已知产物 kind 的展示层友好文件名；真实 key 内含内容哈希，直接展示会破坏布局。 */
export const ARTIFACT_FILENAME: Record<string, string> = {
  'director-ingest': 'script-units.json',
  'director-direct': 'style-bible.md',
  'director-shot-spec': 'shot-plan.json',
  'director-fabricate': 'shot.html',
  'director-assemble': 'assemble-plan.json',
  'director-finalize': 'finalize-report.json',
  'voiceover-audio': 'voiceover.mp3',
  'voiceover-metadata': 'voiceover-metadata.json',
  'subtitle-track': 'subtitle-track.json',
  'qa-vision-report': 'vision-qa-report.json',
  'render-mp4': 'render.mp4',
  'final-mp4': 'final.mp4',
}

export const NODE_LABEL: Record<CanvasGraphNode['type'], string> = {
  'script-import': 'Ingest 语义分镜',
  'shot-split': 'Direct 风格圣经',
  score: 'Assemble 合成',
  export: 'Finalize 导出',
  'shot-script': 'Shot-Spec 分镜合同',
  'shot-codegen': 'Shot 分镜节点',
  'shot-sfx': 'Audio 配音字幕',
  'shot-subtitle': 'Audio 配音字幕',
  'shot-qa': 'Finalize 验收',
  'audio-transcribe': 'Ingest 录音转稿',
  'website-stage': 'Website 受控执行',
}
