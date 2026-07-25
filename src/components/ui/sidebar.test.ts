import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LayoutDashboard } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { PurpleInkSidebar } from './sidebar'

describe('PurpleInkSidebar', () => {
  it('uses caller-owned brand and settings routes', () => {
    const html = renderToStaticMarkup(
      createElement(PurpleInkSidebar, {
        items: [
          {
            label: '工作台',
            icon: LayoutDashboard,
            href: '/products/dashboard',
            active: true,
          },
        ],
        collapsed: false,
        onCollapsedChange: () => undefined,
        accountOpen: true,
        onAccountOpenChange: () => undefined,
        brandHref: '/products/dashboard',
        settingsHref: '/products/settings',
      }),
    )

    expect(html).toContain('href="/products/dashboard"')
    expect(html).toContain('href="/products/settings"')
    expect(html).toContain('工作区设置')
  })
})
