import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LayoutDashboard, X } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { ArtifactChip } from './artifact-chip'
import { Button } from './button'
import {
  CollapsibleCard,
  type CollapsibleCardProps,
} from './collapsible-card'
import { ProgressBar } from './progress-bar'
import { ProjectCard } from './project-card'
import { QueueStatusBar } from './queue-status-bar'
import { IconButton } from './icon-button'
import { NavItem } from './nav-item'
import { SegmentedControl } from './segmented-control'
import { SettingsPanel, type SettingsPanelProps } from './settings-panel'
import { TextArea } from './text-area'
import { TextField } from './text-field'
import { Toggle } from './toggle'

describe('Pencil canonical components', () => {
  it('uses ds tokens for fields, controls, cards, and queue surfaces', () => {
    const html = [
      createElement(TextField, { label: '项目名称' }),
      createElement(TextArea, { label: '源文本' }),
      createElement(Toggle, { checked: true }),
      createElement(ProjectCard, { title: '项目', meta: '1 个镜头' }),
      createElement(QueueStatusBar, {
        completed: 1,
        active: 1,
        waiting: 0,
        failed: 0,
        total: 2,
      }),
      createElement(ProgressBar, { value: 50, label: 'Pipeline 进度' }),
      createElement(ArtifactChip, { filename: 'shot-source.json' }),
      createElement(
        CollapsibleCard,
        { title: '模型服务' } as CollapsibleCardProps,
        '配置内容',
      ),
      createElement(
        SettingsPanel,
        {
          title: '运行与导出',
          description: '独立滚动区中的折叠设置',
        } as SettingsPanelProps,
        '配置内容',
      ),
      createElement(SegmentedControl, {
        options: [{ value: 'data', label: 'Data' }],
        value: 'data',
        onChange: () => undefined,
      }),
    ]
      .map((node) => renderToStaticMarkup(node))
      .join('')

    expect(html).toContain('border-ds-border')
    expect(html).toContain('bg-ds-surface')
    expect(html).toContain('bg-ds-surface-muted')
    expect(html).toContain('text-ds-text')
    expect(html).not.toContain('bg-surface ')
    expect(html).not.toContain('border-separator')
  })

  it('keeps legacy button call sites on the canonical button family', () => {
    const html = (['primary', 'tinted', 'gray', 'destructive'] as const)
      .map((variant) =>
        renderToStaticMarkup(
          createElement(Button, { variant }, variant),
        ),
      )
      .join('')

    expect(html).toContain('ds-primary-button')
    expect(html).toContain('border-ds-border')
    expect(html).toContain('bg-ds-blue-soft')
    expect(html).toContain('bg-ds-red')
    // 状态层配方：统一 focus ring 与 active 下压。
    expect(html).toContain('focus-visible:ring-ds-ring')
    expect(html).toContain('active:translate-y-px')
    expect(html).toContain('active:brightness-95')
    expect(html).toContain('data-motion-press="true"')
  })

  it('uses the shared spatial press and bounded transition contracts', () => {
    const navItemProps: ComponentProps<typeof NavItem> = {
      icon: LayoutDashboard,
      href: '/products/dashboard',
      children: '工作台',
    }
    const html = [
      createElement(IconButton, { icon: X, 'aria-label': '关闭' }),
      createElement(NavItem, navItemProps),
      createElement(SegmentedControl, {
        options: [{ value: 'data', label: 'Data' }],
        value: 'data',
        onChange: () => undefined,
      }),
      createElement(Toggle, { checked: true }),
      createElement(ProgressBar, { value: 50 }),
      createElement(ArtifactChip, {
        filename: 'shot-source.json',
        href: '/api/artifacts/example',
      }),
    ]
      .map((node) => renderToStaticMarkup(node))
      .join('')

    expect(html.match(/data-motion-press="true"/g)?.length).toBe(3)
    expect(html).toContain('data-motion-spring="true"')
    expect(html).toContain('transition-[width] duration-base')
    expect(html).toContain('hover:bg-ds-surface')
    expect(html).not.toContain('hover:brightness-95')
  })
})
