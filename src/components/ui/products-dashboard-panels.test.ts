import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProjectStatisticsPanel } from './project-statistics-panel'
import { RecentProjectsPanel } from './recent-projects-panel'

describe('Products dashboard panels', () => {
  it('renders a truthful status distribution and unavailable trend label', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectStatisticsPanel, {
        metrics: [
          { label: '项目总数', value: '2', source: 'projects.total' },
        ],
        statusDistribution: {
          running: 1,
          failed: 1,
          succeeded: 0,
          idle: 0,
        },
        trendUnavailableLabel: '尚无历史快照可绘制',
      }),
    )

    expect(html).toContain('尚无历史快照可绘制')
    expect(html).toContain('运行中')
    expect(html).toContain('失败')
    expect(html).toContain('>1<')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('项目统计')
    expect(html).toContain('API 调用统计')
    expect(html).toContain('href="/playbook/ui#project-statistics-panel"')
    expect(html).toContain('WorkspaceStatisticsSnapshotV1')
    expect(html).not.toContain('PlaybookFixture')
  })

  it('makes every real recent project open its canonical canvas', () => {
    const html = renderToStaticMarkup(
      createElement(RecentProjectsPanel, {
        projects: [
          {
            id: 'project-1',
            title: '真实项目',
            href: '/products/canvas/project-1',
            meta: '3 个镜头',
            updatedAt: new Date('2026-07-25T10:00:00.000Z'),
            shotCount: 3,
          },
        ],
      }),
    )

    expect(html).toContain('href="/products/canvas/project-1"')
    expect(html).toContain('真实项目')
    expect(html).toContain('3 个镜头')
    expect(html).toContain('href="/products/projects"')
    expect(html).toContain('最近项目')
  })

  it('shows an honest empty state when there are no recent projects', () => {
    const html = renderToStaticMarkup(createElement(RecentProjectsPanel, {}))

    expect(html).toContain('暂无可展示的项目')
    expect(html).toContain('新建项目')
    expect(html).not.toContain('Stage B')
  })
})
