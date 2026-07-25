import type { PipelineNodeStatus } from '@/components/ui/pipeline-node'

export type WorkflowIcon =
  | 'play'
  | 'list-tree'
  | 'sparkles'
  | 'audio-lines'
  | 'film'
  | 'scan-eye'
  | 'combine'

export interface WorkflowBlueprintNode {
  [key: string]: unknown
  id: string
  title: string
  meta: string
  icon: WorkflowIcon
  status: PipelineNodeStatus
  artifact?: string
  position: { x: number; y: number }
}

export interface WorkflowBlueprintEdge {
  id: string
  source: string
  target: string
}

const BASE_NODES = [
  ['start', '开始', 'workflow.input', 'play', 30, 240],
  ['plan', '项目规划', 'project-plan', 'list-tree', 260, 240],
  ['generate', '镜头生成', 'shot-spec + fabricate', 'sparkles', 490, 240],
  ['media', '媒体处理', 'tts + asr + subtitle', 'audio-lines', 740, 140],
  ['render', '画面渲染', 'HyperFrames render', 'film', 740, 340],
  ['qa', '视觉 QA', 'vision-qa', 'scan-eye', 970, 340],
  ['compose', '项目合成', 'compose + verify', 'combine', 1200, 240],
] as const

export const STAGE_B_WORKFLOW_NODES: readonly WorkflowBlueprintNode[] =
  BASE_NODES.map(([id, title, meta, icon, x, y]) => ({
    id,
    title,
    meta,
    icon,
    status: 'unwired',
    position: { x, y },
  }))

export const CANONICAL_WORKFLOW_NODES: readonly WorkflowBlueprintNode[] =
  BASE_NODES.map(([id, title, meta, icon, x, y], index) => ({
    id,
    title,
    meta,
    icon,
    status: (
      ['ready', 'completed', 'running', 'ready', 'ready', 'blocked', 'blocked'] as const
    )[index],
    artifact: [
      'input.json',
      'plan.json',
      'shot-source.json',
      'media.json',
      'preview.mp4',
      'qa-report.json',
      'final.mp4',
    ][index],
    position: { x, y },
  }))

export const WORKFLOW_BLUEPRINT_EDGES: readonly WorkflowBlueprintEdge[] = [
  { id: 'start-plan', source: 'start', target: 'plan' },
  { id: 'plan-generate', source: 'plan', target: 'generate' },
  { id: 'generate-media', source: 'generate', target: 'media' },
  { id: 'generate-render', source: 'generate', target: 'render' },
  { id: 'render-qa', source: 'render', target: 'qa' },
  { id: 'media-compose', source: 'media', target: 'compose' },
  { id: 'qa-compose', source: 'qa', target: 'compose' },
]
