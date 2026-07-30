import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MENU_VIEWPORT_MARGIN,
  resolveContextMenuPlacement,
} from './context-menu-placement'

const VIEWPORT = { width: 1000, height: 800 }
const MENU = { width: 200, height: 160 }

describe('resolveContextMenuPlacement', () => {
  it('opens toward bottom-right when there is room', () => {
    expect(resolveContextMenuPlacement({ x: 120, y: 90 }, MENU, VIEWPORT)).toEqual({
      left: 120,
      top: 90,
      originX: 'left',
      originY: 'top',
    })
  })

  it('flips to the pointer other side when the forward edge overflows', () => {
    expect(resolveContextMenuPlacement({ x: 960, y: 780 }, MENU, VIEWPORT)).toEqual({
      left: 760,
      top: 620,
      originX: 'right',
      originY: 'bottom',
    })
  })

  it('clamps inside the margin when neither side fits', () => {
    const placement = resolveContextMenuPlacement(
      { x: 4, y: 6 },
      { width: 990, height: 790 },
      VIEWPORT,
    )
    expect(placement.left).toBe(CONTEXT_MENU_VIEWPORT_MARGIN)
    expect(placement.top).toBe(CONTEXT_MENU_VIEWPORT_MARGIN)
    expect(placement.originX).toBe('left')
  })

  it('keeps the menu inside the viewport when it is taller than the space below', () => {
    const placement = resolveContextMenuPlacement({ x: 500, y: 700 }, MENU, VIEWPORT)
    expect(placement.top + MENU.height).toBeLessThanOrEqual(VIEWPORT.height)
  })
})
