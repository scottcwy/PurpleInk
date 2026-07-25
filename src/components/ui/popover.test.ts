import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Popover', () => {
  it('anchors a dismissible panel under its trigger without a modal scrim', () => {
    const source = readFileSync('src/components/ui/popover.tsx', 'utf8')

    expect(source).toContain('role="dialog"')
    expect(source).toContain('absolute')
    expect(source).toContain('top-full')
    expect(source).toContain('onOpenChange')
    expect(source).toContain('dismissible')
    expect(source).not.toContain('createPortal')
  })
})
