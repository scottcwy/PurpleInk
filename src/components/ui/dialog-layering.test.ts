import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Dialog layering', () => {
  it('portals dialogs above page-local stacking contexts', () => {
    const source = readFileSync('src/components/ui/dialog.tsx', 'utf8')

    expect(source).toContain('createPortal')
    expect(source).toContain('document.body')
    expect(source).toContain('z-[1000]')
  })
})
