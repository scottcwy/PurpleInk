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
]

describe('AppSidebar', () => {
  it('renders the latest Pencil navigation exactly once', () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { active: 'workbench' })
    )

    for (const label of ['工作台', '项目', '画布', '镜头', '导出']) {
      expect(html.match(new RegExp(`>${label}<`, 'g'))).toHaveLength(1)
    }
  })

  it.each(SECTIONS)('marks only %s as the active destination', (active) => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, {
        active,
        projectId: 'project-1',
        rendererNodeId: 'shot-1',
      }),
    )
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

    expect(html).toContain('/products/canvas/project%2F1')
    expect(html).toContain(
      '/products/shots/node%2F1?projectId=project%2F1'
    )
    expect(html).toContain('/products/export/project%2F1')
  })

  it('does not link context-only pages to a guaranteed 404 without a project', () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { active: 'workbench' })
    )
    expect(html).not.toContain('href="/products/export')
  })

  it('keeps nav labels in the DOM when compact (via Tooltip)', () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { active: 'workbench', compact: true })
    )
    for (const label of ['工作台', '项目', '画布', '镜头', '导出']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })
})
