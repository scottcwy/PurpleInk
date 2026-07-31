import type { AppSection } from './types'

export const PRODUCTS_ROUTES = {
  root: '/products',
  dashboard: '/products/dashboard',
  projects: '/products/projects',
  billing: '/products/billing',
  settings: '/products/settings',
} as const

export function productCanvasHref(projectId: string): string {
  return `/products/canvas/${encodeURIComponent(projectId)}`
}

export function productShotHref(
  shotId: string,
  projectId: string,
): string {
  return `/products/shots/${encodeURIComponent(shotId)}?projectId=${encodeURIComponent(projectId)}`
}

export function productExportHref(projectId: string): string {
  return `/products/export/${encodeURIComponent(projectId)}`
}

export function productSettingsHref(projectId?: string): string {
  return projectId
    ? `${PRODUCTS_ROUTES.settings}?projectId=${encodeURIComponent(projectId)}`
    : PRODUCTS_ROUTES.settings
}

export function resolveProductsSection(pathname: string): AppSection {
  if (pathname.startsWith('/products/shots/')) return 'renderer'
  if (pathname.startsWith('/products/export/')) return 'export'
  if (pathname.startsWith('/products/canvas/')) return 'canvas'
  if (pathname.startsWith(PRODUCTS_ROUTES.projects)) return 'projects'
  if (pathname.startsWith(PRODUCTS_ROUTES.billing)) return 'billing'
  if (pathname.startsWith(PRODUCTS_ROUTES.settings)) return 'settings'
  return 'workbench'
}
