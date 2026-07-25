import type { AppSection } from './types'

export type SidebarMode = 'expanded' | 'rail' | 'hidden'

/** 纯函数：互斥三态。hidden > rail > expanded。 */
export function resolveSidebarMode(
  isHidden: boolean,
  isNarrow: boolean,
  manualCollapsed: boolean,
): SidebarMode {
  if (isHidden) return 'hidden'
  if (isNarrow || manualCollapsed) return 'rail'
  return 'expanded'
}

/**
 * 纯函数：由 pathname 推导激活的导航项。
 * 切页时侧栏据此高亮，不依赖页面传参；canvas 子路由必须先于 canvas 根匹配。
 */
export function resolveActiveSection(pathname: string): AppSection {
  if (pathname.startsWith('/products/shots/')) return 'renderer'
  if (pathname.startsWith('/products/export/')) return 'export'
  if (pathname.startsWith('/products/canvas/')) return 'canvas'
  if (pathname.startsWith('/products/projects')) return 'projects'
  if (pathname.startsWith('/products/settings')) return 'settings'
  return 'workbench'
}
