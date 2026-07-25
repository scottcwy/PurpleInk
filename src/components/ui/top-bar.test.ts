import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('TopBar chrome', () => {
  it('uses a compact 48px row height across the app shell', () => {
    const source = readFileSync('src/components/ui/top-bar.tsx', 'utf8')

    expect(source).toContain('h-12')
    expect(source).not.toContain('h-16')
    expect(source).toContain('48px')
  })
})
