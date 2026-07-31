import { describe, expect, it } from 'vitest'
import {
  productCanvasHref,
  productExportHref,
  productSettingsHref,
  productShotHref,
  PRODUCTS_ROUTES,
  resolveProductsSection,
} from './products-routes'

describe('products routes', () => {
  it('builds canonical routes with encoded dynamic identifiers', () => {
    expect(PRODUCTS_ROUTES.dashboard).toBe('/products/dashboard')
    expect(PRODUCTS_ROUTES.projects).toBe('/products/projects')
    expect(PRODUCTS_ROUTES.billing).toBe('/products/billing')
    expect(productCanvasHref('project/1')).toBe(
      '/products/canvas/project%2F1',
    )
    expect(productShotHref('shot/1', 'project/1')).toBe(
      '/products/shots/shot%2F1?projectId=project%2F1',
    )
    expect(productExportHref('project/1')).toBe(
      '/products/export/project%2F1',
    )
    expect(productSettingsHref('project/1')).toBe(
      '/products/settings?projectId=project%2F1',
    )
  })

  it('resolves the active sidebar section for every products route', () => {
    expect(resolveProductsSection('/products/dashboard')).toBe('workbench')
    expect(resolveProductsSection('/products/projects')).toBe('projects')
    expect(resolveProductsSection('/products/canvas/project-1')).toBe('canvas')
    expect(resolveProductsSection('/products/shots/shot-1')).toBe('renderer')
    expect(resolveProductsSection('/products/export/project-1')).toBe('export')
    expect(resolveProductsSection('/products/settings')).toBe('settings')
    expect(resolveProductsSection('/products/billing')).toBe('billing')
  })
})
