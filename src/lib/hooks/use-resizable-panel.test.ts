import { describe, expect, it } from 'vitest'
import { clampWidth } from './use-resizable-panel'

describe('clampWidth', () => {
  it('applies a positive delta within bounds', () => {
    expect(clampWidth(240, 20, 200, 360)).toBe(260)
  })

  it('clamps to min and max', () => {
    expect(clampWidth(240, -100, 200, 360)).toBe(200)
    expect(clampWidth(240, 200, 200, 360)).toBe(360)
  })

  it('inverts delta for right-side panels', () => {
    // handle on left edge: dragging left (negative delta) widens the panel
    expect(clampWidth(320, -40, 280, 480, true)).toBe(360)
    expect(clampWidth(320, 40, 280, 480, true)).toBe(280)
  })

  it('returns start width when delta is zero', () => {
    expect(clampWidth(300, 0, 200, 400)).toBe(300)
    expect(clampWidth(300, 0, 200, 400, true)).toBe(300)
  })
})
