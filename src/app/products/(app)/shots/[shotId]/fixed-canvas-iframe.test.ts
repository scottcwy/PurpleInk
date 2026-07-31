import { describe, expect, it } from 'vitest'
import { fitFixedCanvas } from './fixed-canvas-iframe'

describe('fitFixedCanvas', () => {
  it.each([
    [{ width: 1920, height: 1080 }, 1],
    [{ width: 1440, height: 810 }, 0.75],
    [{ width: 800, height: 450 }, 800 / 1920],
    [{ width: 800, height: 600 }, 800 / 1920],
  ])('fits the complete master into $width×$height', (container, scale) => {
    expect(fitFixedCanvas(container)).toEqual({
      scale,
      width: 1920 * scale,
      height: 1080 * scale,
    })
  })
})
