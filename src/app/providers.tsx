'use client'

import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'

export function RootProviders({
  children,
}: {
  children: ReactNode
}): ReactNode {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="theme-mode"
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  )
}
