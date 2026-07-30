'use client'

import { LayoutDashboard } from 'lucide-react'
import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { IconButton } from '@/components/ui/icon-button'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { usePersistentToggle } from '@/lib/hooks/use-persistent-toggle'
import {
  BP_SIDEBAR_HIDDEN,
  BP_SIDEBAR_RAIL,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_RAIL_WIDTH,
} from '@/lib/layout/breakpoints'
import { AppSidebar } from './app-sidebar'
import type { SidebarAccountInfo } from '@/components/ui/sidebar'
import { AnimatedAside, DrawerOverlay } from './collapsible-panel'
import { useNavContext } from './nav-context'
import { resolveActiveSection, resolveSidebarMode } from './sidebar-mode'

export { resolveActiveSection, resolveSidebarMode } from './sidebar-mode'
export type { SidebarMode } from './sidebar-mode'

export function AppSidebarShell({
  account,
}: {
  account?: SidebarAccountInfo | null
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const nav = useNavContext()
  const active = resolveActiveSection(pathname)
  const projectId = searchParams.get('projectId') ?? nav.projectId ?? undefined
  const rendererNodeId = nav.rendererNodeId
  const isHidden = useMediaQuery(`(max-width: ${BP_SIDEBAR_HIDDEN - 1}px)`)
  const isNarrow = useMediaQuery(`(max-width: ${BP_SIDEBAR_RAIL - 1}px)`)
  const [manualCollapsed, setManualCollapsed] = usePersistentToggle(
    'purpleink:sidebar-collapsed',
    false,
  )
  const [drawerRequested, setDrawerRequested] = useState(false)
  const mode = resolveSidebarMode(isHidden, isNarrow, manualCollapsed)
  const drawerOpen = mode === 'hidden' && drawerRequested

  if (mode === 'hidden') {
    return (
      <>
        <IconButton
          icon={LayoutDashboard}
          aria-label="打开导航"
          className="fixed left-2 top-2 z-40 shadow-float"
          onClick={() => setDrawerRequested(true)}
        />
        <DrawerOverlay
          open={drawerOpen}
          onDismiss={() => setDrawerRequested(false)}
          side="left"
          scrimLabel="关闭导航遮罩"
          style={{ width: SIDEBAR_DEFAULT_WIDTH }}
        >
          <AppSidebar
            active={active}
            projectId={projectId}
            rendererNodeId={rendererNodeId}
            account={account}
            onCompactChange={() => setDrawerRequested(false)}
            className="h-full w-full"
          />
        </DrawerOverlay>
      </>
    )
  }

  const compact = mode === 'rail'
  return (
    <AnimatedAside
      width={compact ? SIDEBAR_RAIL_WIDTH : SIDEBAR_DEFAULT_WIDTH}
      className="h-full"
    >
      <AppSidebar
        active={active}
        projectId={projectId}
        rendererNodeId={rendererNodeId}
        account={account}
        compact={compact}
        onCompactChange={setManualCollapsed}
        className="h-full w-full"
      />
    </AnimatedAside>
  )
}
