import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppSidebar } from './app-sidebar'
import type { AppSection } from './types'

const SECTIONS: AppSection[] = [
  'workbench',
  'projects',
  'canvas',
  'renderer',
  'export',
  'settings',
]

describe('AppSidebar', () => {
  it('renders the latest Pencil navigation exactly once', () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { active: 'workbench' })
    )

    for (const label of [
      '工作台',
      '项目列表',
      '画布编辑器',
      '分镜渲染器',
      '合成与导出',
      '设置',
      '本地存储 · 模型直连',
    ]) {
      expect(html.match(new RegExp(label, 'g'))).toHaveLength(1)
    }
  })

  it.each(SECTIONS)('marks only %s as the active destination', (active) => {
    const html = renderToStaticMarkup(createElement(AppSidebar, { active }))
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('keeps project context in canvas destinations', () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, {
        active: 'renderer',
        projectId: 'project/1',
        rendererNodeId: 'node/1',
      })
    )

    expect(html).toContain('/canvas?projectId=project%2F1')
    expect(html).toContain(
      '/canvas/shot/node%2F1?projectId=project%2F1'
    )
    expect(html).toContain('/canvas/export?projectId=project%2F1')
    expect(html).toContain('/settings?projectId=project%2F1')
  })

  it('does not link context-only pages to a guaranteed 404 without a project', () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { active: 'workbench' })
    )
    expect(html).not.toContain('href="/canvas/export"')
  })

  it('keeps nav labels in the DOM when compact (via Tooltip)', () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { active: 'workbench', compact: true })
    )
    for (const label of ['工作台', '项目列表', '画布编辑器', '分镜渲染器', '合成与导出', '设置']) {
      expect(html.match(new RegExp(label, 'g'))).toHaveLength(1)
    }
    // compact 态状态文案仅保留为 title，不作为可见文本节点重复渲染
    expect(html).toContain('title="本地存储 · 模型直连"')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })
})
