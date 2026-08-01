import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pageRoutes = ['users', 'billing'] as const
const apiRoutes = [
  'users/route.ts',
  'users/[id]/route.ts',
  'billing/route.ts',
  'billing/batches/route.ts',
  'billing/batches/[id]/route.ts',
] as const

describe('admin account and billing route contracts', () => {
  it.each(pageRoutes)('protects /admin/%s and renders a wired surface', (route) => {
    const path = resolve('src/app/admin', route, 'page.tsx')
    expect(existsSync(path)).toBe(true)
    const source = readFileSync(path, 'utf8')
    expect(source).toContain('requireAdminSession')
    expect(source).not.toContain('待接线')
  })

  it.each(apiRoutes)('protects /api/admin/%s with an isolated route group', (route) => {
    const path = resolve('src/app/api/admin', route)
    expect(existsSync(path)).toBe(true)
    const source = readFileSync(path, 'utf8')
    expect(source).toContain('withAdminSession')
    expect(source).toContain('routeGroup:')
  })

  it('makes users and billing reachable in the shared admin navigation', () => {
    const source = readFileSync(
      resolve('src/features/admin/ui/admin-page-frame.tsx'),
      'utf8',
    )
    expect(source).toContain("href: '/admin/users'")
    expect(source).toContain("href: '/admin/billing'")
    expect(source).not.toContain('用户与计费 · 待接线')
  })
})
