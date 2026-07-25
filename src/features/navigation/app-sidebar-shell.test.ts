import { describe, expect, it } from 'vitest'
import { resolveActiveSection, resolveSidebarMode } from './sidebar-mode'

describe('resolveSidebarMode', () => {
  it('prioritizes hidden over rail and expanded', () => {
    expect(resolveSidebarMode(true, true, false)).toBe('hidden')
    expect(resolveSidebarMode(true, false, true)).toBe('hidden')
  })

  it('uses rail when viewport is narrow', () => {
    expect(resolveSidebarMode(false, true, false)).toBe('rail')
  })

  it('uses rail when manually collapsed on a wide viewport', () => {
    expect(resolveSidebarMode(false, false, true)).toBe('rail')
  })

  it('stays expanded on a wide viewport without manual collapse', () => {
    expect(resolveSidebarMode(false, false, false)).toBe('expanded')
  })
})

describe('resolveActiveSection', () => {
  it('matches canvas sub-routes before the canvas root', () => {
    expect(resolveActiveSection('/products/shots/node-1')).toBe('renderer')
    expect(resolveActiveSection('/products/export/project-1')).toBe('export')
    expect(resolveActiveSection('/products/canvas/project-1')).toBe('canvas')
  })

  it('matches top-level sections', () => {
    expect(resolveActiveSection('/products/dashboard')).toBe('workbench')
    expect(resolveActiveSection('/products/projects')).toBe('projects')
    expect(resolveActiveSection('/products/settings')).toBe('settings')
  })

  it('falls back to workbench for unknown paths', () => {
    expect(resolveActiveSection('/unknown')).toBe('workbench')
  })
})
