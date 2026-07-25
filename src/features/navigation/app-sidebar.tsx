import type { CSSProperties } from 'react'
import {
  Download,
  Film,
  Folder,
  LayoutDashboard,
  Settings,
  Waypoints,
} from 'lucide-react'
import { NavItem } from '@/components/ui/nav-item'
import {
  Sidebar,
  SidebarBrand,
  SidebarDivider,
  SidebarFooter,
  SidebarLocalStatus,
  SidebarNav,
  SidebarSearch,
  SidebarSection,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import type { AppSection } from './types'

export function AppSidebar({
  active,
  projectId,
  rendererNodeId,
  compact = false,
  className,
  style,
}: {
  active: AppSection
  projectId?: string
  rendererNodeId?: string
  compact?: boolean
  className?: string
  style?: CSSProperties
}) {
  const canvasHref = projectHref('/canvas', projectId)
  const rendererHref =
    projectId && rendererNodeId
      ? `/canvas/shot/${encodeURIComponent(rendererNodeId)}?projectId=${encodeURIComponent(projectId)}`
      : canvasHref

  return (
    <Sidebar compact={compact} className={cn('shrink-0', className)} style={style}>
      <SidebarBrand compact={compact} />
      <SidebarSearch aria-label="搜索项目" compact={compact} />
      <SidebarSection compact={compact}>项目</SidebarSection>
      <SidebarNav>
        <NavItem
          icon={LayoutDashboard}
          href="/"
          active={active === 'workbench'}
          compact={compact}
        >
          工作台
        </NavItem>
        <NavItem
          icon={Folder}
          href="/projects"
          active={active === 'projects'}
          compact={compact}
        >
          项目列表
        </NavItem>
        <NavItem
          icon={Waypoints}
          href={canvasHref}
          active={active === 'canvas'}
          compact={compact}
        >
          画布编辑器
        </NavItem>
        <NavItem
          icon={Film}
          href={rendererHref}
          active={active === 'renderer'}
          compact={compact}
        >
          分镜渲染器
        </NavItem>
        <NavItem
          icon={Download}
          href={projectId ? projectHref('/canvas/export', projectId) : canvasHref}
          active={active === 'export'}
          compact={compact}
        >
          合成与导出
        </NavItem>
      </SidebarNav>
      <SidebarDivider />
      <SidebarFooter>
        <NavItem
          icon={Settings}
          href={projectHref('/settings', projectId)}
          active={active === 'settings'}
          compact={compact}
        >
          设置
        </NavItem>
        <SidebarLocalStatus
          compact={compact}
          label="本地存储 · 模型直连"
        />
      </SidebarFooter>
    </Sidebar>
  )
}

function projectHref(pathname: string, projectId?: string): string {
  return projectId
    ? `${pathname}?projectId=${encodeURIComponent(projectId)}`
    : pathname
}
