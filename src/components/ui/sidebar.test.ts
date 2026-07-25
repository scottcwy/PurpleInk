import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LayoutDashboard } from 'lucide-react'
import { ThemeProvider } from 'next-themes'
import { describe, expect, it } from 'vitest'
import { PurpleInkSidebar } from './sidebar'

const baseItems = [
  {
    label: '工作台',
    icon: LayoutDashboard,
    href: '/products/dashboard',
    active: true,
  },
] as const

function renderSidebar(props: {
  collapsed: boolean
  accountOpen: boolean
  brandHref?: string
  settingsHref?: string
}) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      {
        attribute: 'class',
        defaultTheme: 'system',
        enableSystem: true,
        storageKey: 'theme-mode',
      },
      createElement(PurpleInkSidebar, {
        items: [...baseItems],
        collapsed: props.collapsed,
        onCollapsedChange: () => undefined,
        accountOpen: props.accountOpen,
        onAccountOpenChange: () => undefined,
        brandHref: props.brandHref ?? '/',
        settingsHref: props.settingsHref ?? '/products/settings',
      }) as ReactNode,
    ),
  )
}

describe('PurpleInkSidebar', () => {
  it('uses caller-owned brand and settings routes when expanded', () => {
    const html = renderSidebar({
      collapsed: false,
      accountOpen: true,
      brandHref: '/',
      settingsHref: '/products/settings',
    })

    expect(html).toContain('href="/"')
    expect(html).toContain('aria-label="PurpleInk 首页"')
    expect(html).toContain('href="/products/settings"')
    expect(html).toContain('工作区设置')
    expect(html).toContain('aria-label="收起侧栏"')
    expect(html).toContain('外观')
  })

  it('replaces brand logo with expand toggle when collapsed', () => {
    const html = renderSidebar({
      collapsed: true,
      accountOpen: false,
      brandHref: '/',
    })

    expect(html).not.toContain('aria-label="PurpleInk 首页"')
    expect(html).toContain('aria-label="展开侧栏"')
    expect(html.match(/aria-label="展开侧栏"/g)?.length).toBe(1)
  })
})
