import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AiUsageProjectionV1 } from '@/features/usage/client'
import { ProjectStatisticsApiView } from './project-statistics-api-view'
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
        apiUsage: null,
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

  it('renders the account invocation projection without fixture fallbacks', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectStatisticsApiView, {
        initialProjection: usageProjection(),
      }),
    )
    expect(html).toContain('AI 调用统计')
    expect(html).toContain('>4<')
    expect(html).toContain('75%')
    expect(html).toContain('1,650')
    expect(html).toContain('平台托管')
    expect(html).toContain('自己的 API')
    expect(html).toContain('AiUsageProjectionV1')
    expect(html).not.toContain('PlaybookFixture')
    expect(html).not.toContain('1,284')
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

function usageProjection(): AiUsageProjectionV1 {
  return {
    schemaVersion: 1,
    view: 'account',
    range: '7d',
    timeZone: 'UTC',
    coverage: {
      completeFrom: '2026-07-29T00:00:00.000Z',
      includesManagedHistory: false,
      byokHistoryMissing: true,
      attributionComplete: true,
    },
    summary: {
      actualCalls: 4,
      succeeded: 3,
      failed: 1,
      running: 0,
      successRate: 75,
      reportedTokens: {
        input: 1000,
        cachedInput: 200,
        output: 400,
        reasoning: 50,
        total: 1650,
      },
      ttsCharacters: 0,
      asrAudioSeconds: 0,
      p95DurationMs: 300,
      recentCallAt: '2026-07-30T00:00:00.000Z',
    },
    series: [{
      date: '2026-07-30',
      managedCalls: 2,
      ownApiCalls: 2,
      succeeded: 3,
      failed: 1,
      running: 0,
      reportedTokens: 1650,
      cumulativePercent: null,
    }],
    breakdown: {
      funding: [
        { key: 'managed', label: '平台托管', calls: 2, percent: 50 },
        { key: 'byok', label: '自己的 API', calls: 2, percent: 50 },
      ],
      provider: [
        { key: 'gemini', label: 'gemini', calls: 4, percent: 100 },
      ],
      capability: [
        { key: 'text', label: 'text', calls: 4, percent: 100 },
      ],
      operation: [
        { key: 'workflow', label: 'workflow', calls: 4, percent: 100 },
      ],
    },
    usageUnavailableCount: 0,
  }
}
