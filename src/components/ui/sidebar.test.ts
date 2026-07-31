import { readFileSync } from 'node:fs'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LayoutDashboard } from 'lucide-react'
import { ThemeProvider } from 'next-themes'
import { describe, expect, it } from 'vitest'
import { PurpleInkSidebar } from './sidebar'
import { AccountMenu } from './sidebar-chrome'

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
  it('leaves width and width motion ownership to its container', () => {
    const sidebarSource = readFileSync('src/components/ui/sidebar.tsx', 'utf8')
    const demoSource = readFileSync('src/components/ui/sidebar.demo.tsx', 'utf8')

    expect(sidebarSource).not.toContain('transition-[width]')
    expect(sidebarSource).not.toContain(['duration', '200'].join('-'))
    expect(sidebarSource).not.toContain("w-[60px]")
    expect(sidebarSource).not.toContain("w-[248px]")
    expect(demoSource).toContain('<AnimatedAside')
    expect(demoSource).toContain('SIDEBAR_RAIL_WIDTH')
    expect(demoSource).toContain('SIDEBAR_DEFAULT_WIDTH')
  })

  it('uses caller-owned brand and settings routes when expanded', () => {
    const html = renderSidebar({
      collapsed: false,
      accountOpen: true,
      brandHref: '/',
      settingsHref: '/products/settings',
    })

    expect(html).toContain('href="/"')
    expect(html).toContain('aria-label="PurpleInk 首页"')
    expect(html).toContain('aria-label="收起侧栏"')

    // 账户菜单位于 Popover 内：闭合覆盖层不再挂载内容（overlay-root 不变量，
    // 见 motion-interaction.md §4.2），SSR 首帧 popover 恒为 closed，
    // 菜单内容合同改为直接渲染 AccountMenu 断言。
    const menuHtml = renderToStaticMarkup(
      createElement(AccountMenu, {
        settingsHref: '/products/settings',
      }) as ReactNode,
    )
    expect(menuHtml).toContain('href="/products/settings"')
    expect(menuHtml).toContain('工作区设置')
    expect(menuHtml).toContain('外观')
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
