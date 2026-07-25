import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PRODUCT_ROUTE_FILES = [
  'src/app/products/page.tsx',
  'src/app/products/(app)/layout.tsx',
  'src/app/products/(app)/dashboard/page.tsx',
  'src/app/products/(app)/projects/page.tsx',
  'src/app/products/(app)/canvas/[projectId]/page.tsx',
  'src/app/products/(app)/shots/[shotId]/page.tsx',
  'src/app/products/(app)/export/[projectId]/page.tsx',
  'src/app/products/(app)/settings/page.tsx',
] as const

const RETIRED_ROUTE_FILES = [
  'src/app/legacy/(app)/layout.tsx',
  'src/app/(product)/dashboard/page.tsx',
  'src/app/(product)/products/page.tsx',
  'src/app/(product)/products/[productId]/page.tsx',
] as const

describe('Products route migration', () => {
  it('materializes every canonical Products route', () => {
    expect(PRODUCT_ROUTE_FILES.filter((file) => !existsSync(file))).toEqual([])
  })

  it('removes retired route entries after moving their behavior', () => {
    expect(RETIRED_ROUTE_FILES.filter((file) => existsSync(file))).toEqual([])
  })

  it('uses the canonical Playbook sidebar in the Products AppShell', () => {
    const sidebarSource = readFileSync(
      'src/features/navigation/app-sidebar.tsx',
      'utf8',
    )

    expect(sidebarSource).toContain('@/components/ui/sidebar')
    expect(sidebarSource).toContain('<PurpleInkSidebar')
    expect(sidebarSource).not.toContain('LegacySidebar')
  })

  it('does not leave executable legacy links in application source', () => {
    const routeSources = PRODUCT_ROUTE_FILES.filter((file) =>
      existsSync(file),
    ).map((file) => readFileSync(file, 'utf8'))

    expect(routeSources.join('\n')).not.toContain('/legacy')
  })

  it('does not flush a shared loading boundary before dynamic 404 guards resolve', () => {
    expect(existsSync('src/app/products/(app)/loading.tsx')).toBe(false)
  })
})
