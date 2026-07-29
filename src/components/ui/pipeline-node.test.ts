import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PipelineNode } from './pipeline-node'
import {
  getNodeStatusLabel,
  getNodeStatusPresentation,
} from './pipeline-node-status'

describe('PipelineNode', () => {
  it('renders NodeStatus labels and selected ring tokens', () => {
    const idle = renderToStaticMarkup(
      createElement(PipelineNode, {
        title: '脚本导入',
        nodeType: 'script-import',
        status: 'idle',
      }),
    )
    const selected = renderToStaticMarkup(
      createElement(PipelineNode, {
        title: '语义拆分',
        nodeType: 'shot-split',
        status: 'success',
        selected: true,
      }),
    )

    expect(idle).toContain('空闲')
    expect(idle).toContain('w-[220px]')
    expect(idle).toContain('h-[100px]')
    expect(idle).toContain('border-stage-ingest')
    expect(selected).toContain('data-selected="true"')
    expect(selected).toContain('border-ds-blue')
    expect(selected).toContain('ring-ds-blue/35')
    expect(selected).toContain('已完成')
  })
})

describe('pipeline-node-status', () => {
  it('expresses skipped with text plus an icon, not colour alone', () => {
    const skipped = getNodeStatusPresentation('skipped')
    expect(skipped.label).toBe('已跳过')
    expect(skipped.icon).toBeDefined()
  })

  it('expresses a confirmation block as waiting rather than failure', () => {
    const blocked = getNodeStatusPresentation('blocked')
    expect(blocked.label).toBe('等待降级确认')
    expect(blocked.variant).toBe('pending')
    expect(blocked.icon).toBeDefined()
  })

  it('labels a skipped QA node as unaccepted while keeping other skips generic', () => {
    expect(getNodeStatusLabel('shot-qa', 'skipped')).toBe('已跳过 · 未验收')
    expect(getNodeStatusLabel('shot-codegen', 'skipped')).toBe('已跳过')
  })
})
