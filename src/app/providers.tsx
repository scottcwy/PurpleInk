'use client'

import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'
import { ToastViewport } from '@/components/ui/toast-viewport'

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
      <ToastViewport />
    </ThemeProvider>
  )
}
