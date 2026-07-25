import type { CanvasNodeType } from '@/features/canvas/types'

export function nodeTypeColorToken(nodeType: CanvasNodeType): string {
  const map: Record<CanvasNodeType, string> = {
    'script-import': 'text-stage-ingest border-stage-ingest',
    'shot-split': 'text-stage-direct border-stage-direct',
    score: 'text-stage-audio border-stage-audio',
    export: 'text-stage-finalize border-stage-finalize',
    'shot-script': 'text-stage-shot border-stage-shot',
    'shot-codegen': 'text-stage-shot border-stage-shot',
    'shot-sfx': 'text-stage-audio border-stage-audio',
    'shot-subtitle': 'text-stage-audio border-stage-audio',
    'shot-qa': 'text-stage-finalize border-stage-finalize',
  }
  return map[nodeType]
}

export function nodeTypeFillClass(nodeType: CanvasNodeType): string {
  const map: Record<CanvasNodeType, string> = {
    'script-import': 'bg-stage-ingest',
    'shot-split': 'bg-stage-direct',
    score: 'bg-stage-audio',
    export: 'bg-stage-finalize',
    'shot-script': 'bg-stage-shot',
    'shot-codegen': 'bg-stage-shot',
    'shot-sfx': 'bg-stage-audio',
    'shot-subtitle': 'bg-stage-audio',
    'shot-qa': 'bg-stage-finalize',
  }
  return map[nodeType]
}
