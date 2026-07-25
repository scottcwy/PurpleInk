import { describe, expect, it } from 'vitest'
import {
  DURATION,
  EASE,
  TRANSITION_BASE,
  TRANSITION_INSTANT,
} from './tokens'

describe('motion tokens', () => {
  it('keeps durations ascending and in seconds', () => {
    expect(DURATION.fast).toBeLessThan(DURATION.base)
    expect(DURATION.base).toBeLessThan(DURATION.slow)
    expect(DURATION.base).toBeCloseTo(0.22)
  })

  it('defines easings as 4-point cubic-bezier control points', () => {
    for (const ease of Object.values(EASE)) {
      expect(ease).toHaveLength(4)
    }
  })

  it('derives the base transition from the standard ease + base duration', () => {
    expect(TRANSITION_BASE.duration).toBe(DURATION.base)
    expect(TRANSITION_BASE.ease).toEqual(EASE.standard)
  })

  it('disables animation for the instant (drag) transition', () => {
    expect(TRANSITION_INSTANT.duration).toBe(0)
  })
})
