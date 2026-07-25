'use client'

import {
  Download,
  FolderKanban,
  LayoutDashboard,
  PanelTop,
  Waypoints,
} from 'lucide-react'
import { useState } from 'react'
import {
  PurpleInkSidebar,
  type PurpleInkSidebarItem,
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
  compact = false,
  onCompactChange,
  className,
}: {
  active: AppSection
  projectId?: string
  rendererNodeId?: string
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
    <PurpleInkSidebar
      items={items}
      collapsed={compact}
      onCollapsedChange={(next) => onCompactChange?.(next)}
      accountOpen={accountOpen}
      onAccountOpenChange={setAccountOpen}
      brandHref="/"
      settingsHref={productSettingsHref(projectId)}
      className={cn('shrink-0', className)}
    />
  )
}
