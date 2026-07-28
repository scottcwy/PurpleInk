'use client'

import {
  Download,
  FolderKanban,
  LayoutDashboard,
  PanelTop,
  Waypoints,
} from 'lucide-react'
import { useState } from 'react'
import { performLogout } from '@/features/auth/logout-client'
import { BillingSidebarUsage } from '@/features/billing/ui/usage-panels'
import {
  PurpleInkSidebar,
  type PurpleInkSidebarItem,
  type SidebarAccountInfo,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import {
  productCanvasHref,
  productExportHref,
  productSettingsHref,
  productShotHref,
  PRODUCTS_ROUTES,
} from './products-routes'
import type { AppSection } from './types'

export function AppSidebar({
  active,
  projectId,
  rendererNodeId,
  account,
  compact = false,
  onCompactChange,
  className,
}: {
  active: AppSection
  projectId?: string
  rendererNodeId?: string
  account?: SidebarAccountInfo | null
  compact?: boolean
  onCompactChange?: (compact: boolean) => void
  className?: string
}) {
  const [accountOpen, setAccountOpen] = useState(false)
  const items: readonly PurpleInkSidebarItem[] = [
    {
      href: PRODUCTS_ROUTES.dashboard,
      label: '工作台',
      icon: LayoutDashboard,
      active: active === 'workbench',
    },
    {
      href: PRODUCTS_ROUTES.projects,
      label: '项目',
      icon: FolderKanban,
      active: active === 'projects',
    },
    {
      href: projectId ? productCanvasHref(projectId) : undefined,
      label: '画布',
      icon: Waypoints,
      active: active === 'canvas',
      disabledReason: '请先选择一个项目',
    },
    {
      href:
        projectId && rendererNodeId
          ? productShotHref(rendererNodeId, projectId)
          : undefined,
      label: '镜头',
      icon: PanelTop,
      active: active === 'renderer',
      disabledReason: '当前项目还没有可渲染镜头',
    },
    {
      href: projectId ? productExportHref(projectId) : undefined,
      label: '导出',
      icon: Download,
      active: active === 'export',
      disabledReason: '请先选择一个项目',
    },
  ]

  return (
    <div
      className={cn(
        'relative h-full shrink-0',
        compact ? 'w-[60px]' : 'w-[248px]',
        className,
      )}
    >
      <PurpleInkSidebar
        items={items}
        collapsed={compact}
        onCollapsedChange={(next) => onCompactChange?.(next)}
        accountOpen={accountOpen}
        onAccountOpenChange={setAccountOpen}
        account={account}
        onLogout={performLogout}
        brandHref="/"
        settingsHref={productSettingsHref(projectId)}
        className="h-full"
      />
      <div
        className={cn(
          'absolute bottom-[72px] z-20',
          compact ? 'left-1/2 -translate-x-1/2' : 'inset-x-3',
        )}
      >
        <BillingSidebarUsage compact={compact} />
      </div>
    </div>
  )
}
