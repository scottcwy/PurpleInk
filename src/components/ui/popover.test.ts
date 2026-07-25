import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Popover', () => {
  it('portals above page media stacking contexts like Dialog', () => {
    const source = readFileSync('src/components/ui/popover.tsx', 'utf8')

    expect(source).toContain('role="dialog"')
    expect(source).toContain('createPortal')
    expect(source).toContain('document.body')
    expect(source).toContain('z-[1000]')
    expect(source).toContain('z-[1001]')
    expect(source).toContain('onOpenChange')
    expect(source).toContain('dismissible')
    expect(source).toContain('getBoundingClientRect')
  })
})
