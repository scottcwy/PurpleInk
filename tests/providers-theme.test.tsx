import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const themeProviderProps = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))

vi.mock('next-themes', () => ({
  ThemeProvider: ({
    children,
    ...props
  }: {
    children: ReactNode
    [key: string]: unknown
  }) => {
    themeProviderProps.current = props
    return children
  },
}))

import { RootProviders } from '@/app/providers'

describe('RootProviders theme contract', () => {
  beforeEach(() => {
    themeProviderProps.current = {}
  })

  it('shares the theme-mode storage contract used by Products settings', () => {
    renderToStaticMarkup(
      <RootProviders>
        <span>content</span>
      </RootProviders>,
    )

    expect(themeProviderProps.current).toMatchObject({
      attribute: 'class',
      defaultTheme: 'system',
      enableSystem: true,
      storageKey: 'theme-mode',
    })
  })
})
