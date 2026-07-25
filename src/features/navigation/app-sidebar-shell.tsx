'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronRight, LayoutDashboard } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { usePersistentToggle } from '@/lib/hooks/use-persistent-toggle'
import { useResizablePanel } from '@/lib/hooks/use-resizable-panel'
import {
  BP_SIDEBAR_HIDDEN,
  BP_SIDEBAR_RAIL,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
} from '@/lib/layout/breakpoints'
import { AppSidebar } from './app-sidebar'
import { AnimatedAside, DrawerOverlay } from './collapsible-panel'
import { useNavContext } from './nav-context'
import { resolveActiveSection, resolveSidebarMode } from './sidebar-mode'

export { resolveActiveSection, resolveSidebarMode } from './sidebar-mode'
export type { SidebarMode } from './sidebar-mode'

export function AppSidebarShell() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const nav = useNavContext()
  const active = resolveActiveSection(pathname)
  const projectId = searchParams.get('projectId') ?? nav.projectId ?? undefined
  const rendererNodeId = nav.rendererNodeId

  const isHidden = useMediaQuery(`(max-width: ${BP_SIDEBAR_HIDDEN - 1}px)`)
  const isNarrow = useMediaQuery(`(max-width: ${BP_SIDEBAR_RAIL - 1}px)`)
  const [manualCollapsed, setManualCollapsed] = usePersistentToggle(
    'cvc:sidebar-collapsed',
    false,
  )
  const { width, isDragging, handlePointerDown, setWidth } = useResizablePanel({
    storageKey: 'cvc:sidebar-width',
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
  })
  const [drawerRequested, setDrawerRequested] = useState(false)

  const mode = resolveSidebarMode(isHidden, isNarrow, manualCollapsed)
  const drawerOpen = mode === 'hidden' && drawerRequested

  useEffect(() => {
    if (!drawerOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerRequested(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

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
            className="h-full w-full"
          />
        </DrawerOverlay>
      </>
    )
  }

  const compact = mode === 'rail'
  const asideWidth = compact ? SIDEBAR_RAIL_WIDTH : width

  return (
    <div className="relative flex h-full shrink-0">
      <AnimatedAside width={asideWidth} animateWidth={!isDragging} className="h-full">
        <AppSidebar
          active={active}
          projectId={projectId}
          rendererNodeId={rendererNodeId}
          compact={compact}
          className="h-full w-full"
        />
      </AnimatedAside>
      {compact
        ? !isNarrow && (
            <IconButton
              icon={ChevronRight}
              aria-label="展开侧边栏"
              className="absolute -right-3 top-3 z-20 shadow-card"
              onClick={() => setManualCollapsed(false)}
            />
          )
        : (
            <>
              <div className="absolute right-2 top-3 z-20">
                <IconButton
                  icon={ChevronRight}
                  aria-label="收起侧边栏"
                  className="shadow-card [&>svg]:rotate-180"
                  onClick={() => setManualCollapsed(true)}
                />
              </div>
              <ResizeHandle
                className="absolute inset-y-0 right-0"
                isDragging={isDragging}
                onPointerDown={handlePointerDown}
                onKeyAdjust={(delta) => setWidth(width + delta)}
                aria-label="调节导航侧边栏宽度"
              />
            </>
          )}
    </div>
  )
}
