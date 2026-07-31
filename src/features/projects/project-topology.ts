import type { CanvasNodeType } from '@/features/canvas'
import type { PipelineStage } from '@/features/director'
import type { ProjectSourcePayload } from './project-source'
import type { ProjectVisualStyle } from './project-visual-style'

export interface ProjectTopologyNode {
  type: CanvasNodeType
  stage: PipelineStage
  logicalKey: string
  data: {
    schemaVersion: 1
    payload: Record<string, unknown>
  }
}

export interface ProjectTopologyEdge {
  sourceLogicalKey: string
  targetLogicalKey: string
}

export interface ProjectTopology {
  entryLogicalKey: string
  nodes: ProjectTopologyNode[]
  edges: ProjectTopologyEdge[]
}

export function projectWorkflowEntryLogicalKey(
  kind: ProjectSourcePayload['kind'],
): string {
  switch (kind) {
    case 'script':
      return 'global:script-import'
    case 'audio':
      return 'source:audio-transcribe'
    case 'website':
      return 'website:capture'
  }
}

const reusedWorkflowNodes = (): ProjectTopologyNode[] => [
  node('shot-split', 'DIRECT', 'global:shot-split'),
  node('score', 'ASSEMBLE', 'global:score'),
  node('export', 'FINALIZE', 'global:export'),
]

const reusedWorkflowEdges = (
  entryLogicalKey: string,
): ProjectTopologyEdge[] => [
  edge(entryLogicalKey, 'global:shot-split'),
  edge('global:score', 'global:export'),
]

/**
 * 构造项目初始 DAG 的纯定义。
 *
 * 完整来源仅存 project_sources。画布节点只保留编排所需的白名单字段，
 * 因而 website URL 查询串、录音对象键与任何凭据都不会复制到节点数据。
 */
export function buildProjectTopology(
  source: ProjectSourcePayload,
): ProjectTopology {
  switch (source.kind) {
    case 'script':
      return scriptTopology(source)
    case 'audio':
      return audioTopology(source)
    case 'website':
      return websiteTopology(source)
  }
}

function scriptTopology(
  source: Extract<ProjectSourcePayload, { kind: 'script' }>,
): ProjectTopology {
  const entry = node('script-import', 'INGEST', projectWorkflowEntryLogicalKey('script'), {
    directorInput: { rawScript: source.script },
    visualTheme: source.visualTheme,
    ...visualStylePayload(source),
  })
  return {
    entryLogicalKey: entry.logicalKey,
    nodes: [entry, ...reusedWorkflowNodes()],
    edges: reusedWorkflowEdges(entry.logicalKey),
  }
}

function audioTopology(
  source: Extract<ProjectSourcePayload, { kind: 'audio' }>,
): ProjectTopology {
  const entry = node(
    'audio-transcribe',
    'INGEST',
    projectWorkflowEntryLogicalKey('audio'),
    {
      workflowKind: 'audio',
      visualTheme: source.visualTheme,
      ...visualStylePayload(source),
    },
  )
  return {
    entryLogicalKey: entry.logicalKey,
    nodes: [entry, ...reusedWorkflowNodes()],
    edges: reusedWorkflowEdges(entry.logicalKey),
  }
}

function websiteTopology(
  source: Extract<ProjectSourcePayload, { kind: 'website' }>,
): ProjectTopology {
  const entryLogicalKey = projectWorkflowEntryLogicalKey('website')
  const phases = [
    ['capture', 'INGEST'],
    ['script', 'DIRECT'],
    ['narration', 'SHOT_SPEC'],
    ['compose', 'FABRICATE'],
    ['render', 'ASSEMBLE'],
    ['export', 'FINALIZE'],
  ] as const satisfies readonly (readonly [string, PipelineStage])[]

  const nodes = phases.map(([phase, stage]) =>
    node('website-stage', stage, `website:${phase}`, {
      workflowKind: 'website',
      phase,
      visualTheme: source.visualTheme,
      ...visualStylePayload(source),
    }),
  )
  const edges = nodes.slice(0, -1).map((current, index) =>
    edge(current.logicalKey, nodes[index + 1]!.logicalKey),
  )
  return { entryLogicalKey, nodes, edges }
}

function visualStylePayload(source: {
  visualStyle?: ProjectVisualStyle
  customVisualStyle?: string
}): Record<string, string> {
  if (!source.visualStyle || source.visualStyle === 'default') return {}
  if (source.visualStyle === 'custom' && source.customVisualStyle) {
    return {
      visualStyle: source.visualStyle,
      customVisualStyle: source.customVisualStyle,
    }
  }
  return { visualStyle: source.visualStyle }
}

function node(
  type: CanvasNodeType,
  stage: PipelineStage,
  logicalKey: string,
  payload: Record<string, unknown> = {},
): ProjectTopologyNode {
  return {
    type,
    stage,
    logicalKey,
    data: { schemaVersion: 1, payload },
  }
}

function edge(
  sourceLogicalKey: string,
  targetLogicalKey: string,
): ProjectTopologyEdge {
  return { sourceLogicalKey, targetLogicalKey }
}
