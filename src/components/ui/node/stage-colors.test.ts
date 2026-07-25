import { describe, expect, it } from 'vitest'
import type { CanvasNodeType } from '@/features/canvas/types'
import { nodeTypeColorToken, nodeTypeFillClass } from './stage-colors'

const nodeTypes: CanvasNodeType[] = [
  'script-import',
  'shot-split',
  'score',
  'export',
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
]

describe('node type visual tokens', () => {
  it.each(nodeTypes)('maps %s to explicit border and fill tokens', (nodeType) => {
    expect(nodeTypeColorToken(nodeType)).toMatch(/^text-stage-\w+ border-stage-\w+$/)
    expect(nodeTypeFillClass(nodeType)).toMatch(/^bg-stage-\w+$/)
  })
})
