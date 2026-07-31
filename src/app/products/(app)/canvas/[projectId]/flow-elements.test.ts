import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CanvasGraphNode, CanvasNodeType, PositionedCanvasNode } from '@/features/canvas'
import {
  buildLaneSummaries,
  getNodeStatusLabel,
  getNodeStatusPresentation,
  LaneSummaryDetails,
  miniMapNodeColor,
  toFlowNode,
} from './flow-elements'

const NODE_TYPES: CanvasNodeType[] = [
  'script-import',
  'shot-split',
  'score',
  'export',
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
  'audio-transcribe',
  'website-stage',
]

const EXPECTED_MINIMAP_COLOR: Record<CanvasNodeType, string> = {
  'script-import': 'var(--color-stage-ingest)',
  'shot-split': 'var(--color-stage-ingest)',
  score: 'var(--color-stage-assemble)',
  export: 'var(--color-stage-finalize)',
  'shot-script': 'var(--color-stage-shot)',
  'shot-codegen': 'var(--color-stage-direct)',
  'shot-sfx': 'var(--color-stage-audio)',
  'shot-subtitle': 'var(--color-stage-audio)',
  'shot-qa': 'var(--color-stage-finalize)',
  'audio-transcribe': 'var(--color-stage-audio)',
  'website-stage': 'var(--color-stage-direct)',
}

describe('miniMapNodeColor', () => {
  it.each(NODE_TYPES)('maps %s to the canvas stage CSS variable', (type) => {
    expect(
      miniMapNodeColor({
        id: type,
        position: { x: 0, y: 0 },
        data: { nodeType: type },
      })
    ).toBe(EXPECTED_MINIMAP_COLOR[type])
  })

  it('falls back when node data type is unknown', () => {
    expect(
      miniMapNodeColor({
        id: 'x',
        position: { x: 0, y: 0 },
        data: { nodeType: 'unknown' },
      })
    ).toBe('var(--ds-text-muted)')
  })
})

describe('toFlowNode', () => {
  it('emits pipeline node type with serializable data and no ReactNode label', () => {
    const node = toFlowNode(
      {
        id: 'n1',
        type: 'shot-script',
        status: 'running',
        stage: null,
        data: {},
        laneKey: 'S001',
        laneRole: 'shot-script',
        position: { x: 10, y: 20 },
      } as PositionedCanvasNode,
      new Set(),
      new Set(['S001']),
      true,
    )

    expect(node.type).toBe('pipeline')
    expect(node.selected).toBe(true)
    expect(node.data).toEqual({
      nodeType: 'shot-script',
      status: 'running',
      laneKey: 'S001',
      collapsed: true,
    })
    expect(node.className).toContain('!bg-transparent')
  })
})

describe('getNodeStatusPresentation', () => {
  it('expresses skipped with text plus an icon, not colour alone', () => {
    const skipped = getNodeStatusPresentation('skipped')

    expect(skipped.label).toBe('已跳过')
    expect(skipped.icon).toBeDefined()
  })

  it('keeps existing statuses icon-free and truthfully labelled', () => {
    expect(getNodeStatusPresentation('failed')).toEqual({
      variant: 'failed',
      label: '失败',
    })
  })

  it('labels a skipped QA node as unaccepted while keeping other skips generic', () => {
    expect(getNodeStatusLabel('shot-qa', 'skipped')).toBe('已跳过 · 未验收')
    expect(getNodeStatusLabel('shot-codegen', 'skipped')).toBe('已跳过')
  })
})

describe('buildLaneSummaries', () => {
  it('groups lane nodes in stable lane and role order while preserving real statuses', () => {
    const nodes = [
      graphNode('global', 'script-import', 'success', null),
      graphNode('s002-qa', 'shot-qa', 'stale', 'S002'),
      graphNode('s001-qa', 'shot-qa', 'failed', 'S001'),
      graphNode('s001-script', 'shot-script', 'success', 'S001'),
      graphNode('s002-code', 'shot-codegen', 'stale', 'S002'),
      graphNode('s001-sfx', 'shot-sfx', 'idle', 'S001'),
      graphNode('s002-script', 'shot-script', 'stale', 'S002'),
      graphNode('s001-code', 'shot-codegen', 'running', 'S001'),
      graphNode('s002-subtitle', 'shot-subtitle', 'stale', 'S002'),
      graphNode('s001-subtitle', 'shot-subtitle', 'pending', 'S001'),
      graphNode('s002-sfx', 'shot-sfx', 'stale', 'S002'),
    ]

    expect(buildLaneSummaries(nodes)).toEqual([
      {
        laneKey: 'S001',
        nodes: [
          { type: 'shot-script', status: 'success' },
          { type: 'shot-codegen', status: 'running' },
          { type: 'shot-sfx', status: 'idle' },
          { type: 'shot-subtitle', status: 'pending' },
          { type: 'shot-qa', status: 'failed' },
        ],
        isComplete: true,
      },
      {
        laneKey: 'S002',
        nodes: [
          { type: 'shot-script', status: 'stale' },
          { type: 'shot-codegen', status: 'stale' },
          { type: 'shot-sfx', status: 'stale' },
          { type: 'shot-subtitle', status: 'stale' },
          { type: 'shot-qa', status: 'stale' },
        ],
        isComplete: true,
      },
    ])
  })

  it('normalizes and safely truncates the real shot-script excerpt', () => {
    const normalized = buildLaneSummaries([
      graphNode('script', 'shot-script', 'idle', 'S001', {
        sourceUnit: { text: '  第一段\n真实\t脚本  ' },
      }),
    ])
    const truncated = buildLaneSummaries([
      graphNode('script', 'shot-script', 'idle', 'S002', {
        sourceUnit: { text: `${'甲'.repeat(48)}乙` },
      }),
    ])
    const malformed = buildLaneSummaries([
      graphNode('script', 'shot-script', 'idle', 'S003', {
        sourceUnit: { text: 42 },
      }),
    ])

    expect(normalized[0]?.sourceExcerpt).toBe('第一段 真实 脚本')
    expect(truncated[0]?.sourceExcerpt).toBe(`${'甲'.repeat(48)}…`)
    expect(malformed[0]?.sourceExcerpt).toBeUndefined()
  })

  it('marks incomplete lanes without inventing missing node statuses', () => {
    expect(
      buildLaneSummaries([
        graphNode('script', 'shot-script', 'success', 'S001'),
        graphNode('qa', 'shot-qa', 'failed', 'S001'),
      ])
    ).toEqual([
      {
        laneKey: 'S001',
        nodes: [
          { type: 'shot-script', status: 'success' },
          { type: 'shot-qa', status: 'failed' },
        ],
        isComplete: false,
      },
    ])
  })

  it('renders role-labelled real statuses and the source excerpt', () => {
    const html = renderToStaticMarkup(
      createElement(LaneSummaryDetails, {
        summary: {
          laneKey: 'S001',
          nodes: [
            { type: 'shot-script', status: 'success' },
            { type: 'shot-codegen', status: 'running' },
            { type: 'shot-sfx', status: 'idle' },
            { type: 'shot-subtitle', status: 'pending' },
            { type: 'shot-qa', status: 'failed' },
          ],
          sourceExcerpt: '第一段真实脚本',
          isComplete: true,
        },
      })
    )

    expect(html).toContain('第一段真实脚本')
    expect(html).toContain('脚本 · 已完成')
    expect(html).toContain('代码 · 执行中')
    expect(html).toContain('音效 · 空闲')
    expect(html).toContain('字幕 · 待执行')
    expect(html).toContain('验收 · 失败')
    expect(html).not.toContain('数据不完整')
  })

  it('renders the skipped badge with the circle-slash icon', () => {
    const html = renderToStaticMarkup(
      createElement(LaneSummaryDetails, {
        summary: {
          laneKey: 'S001',
          nodes: [
            { type: 'shot-script', status: 'success' },
            { type: 'shot-codegen', status: 'success' },
            { type: 'shot-sfx', status: 'skipped' },
            { type: 'shot-subtitle', status: 'pending' },
            { type: 'shot-qa', status: 'idle' },
          ],
          isComplete: true,
        },
      })
    )

    expect(html).toContain('音效 · 已跳过')
    expect(html).toContain('lucide-circle-slash')
  })

  it('renders a truthful count for incomplete lane data', () => {
    const html = renderToStaticMarkup(
      createElement(LaneSummaryDetails, {
        summary: {
          laneKey: 'S001',
          nodes: [
            { type: 'shot-script', status: 'success' },
            { type: 'shot-qa', status: 'failed' },
          ],
          isComplete: false,
        },
      })
    )

    expect(html).toContain('数据不完整 2/5')
    expect(html).not.toContain('代码 ·')
    expect(html).not.toContain('音效 ·')
    expect(html).not.toContain('字幕 ·')
  })
})

function graphNode(
  id: string,
  type: CanvasGraphNode['type'],
  status: CanvasGraphNode['status'],
  laneKey: string | null,
  data: Record<string, unknown> = {}
): CanvasGraphNode {
  return {
    id,
    type,
    status,
    stage: null,
    data,
    laneKey,
    laneRole: laneKey ? type : null,
  } as CanvasGraphNode
}
