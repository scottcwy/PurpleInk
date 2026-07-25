import { describe, expect, it } from 'vitest'
import { isLeavingTowardPanel } from './hover-preview-geometry'

function rect(partial: Partial<DOMRect> & Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): DOMRect {
  const left = partial.left
  const top = partial.top
  const width = partial.width
  const height = partial.height
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return this
    },
  }
}

describe('isLeavingTowardPanel', () => {
  const panel = rect({ left: 100, top: 120, width: 200, height: 100 })

  it('keeps open when leave point is already in the bridge gap', () => {
    expect(isLeavingTowardPanel(150, 115, 0, 1, panel)).toBe(true)
  })

  it('keeps open when velocity rays into the panel', () => {
    expect(isLeavingTowardPanel(150, 80, 0, 4, panel)).toBe(true)
  })

  it('closes when velocity points away from the panel', () => {
    expect(isLeavingTowardPanel(150, 80, 0, -4, panel)).toBe(false)
  })
})
