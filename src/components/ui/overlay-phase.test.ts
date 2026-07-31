import { describe, expect, it } from 'vitest'
import {
  completeOverlayPhase,
  isOverlayPresented,
  overlayAnimationTarget,
  resolveOverlayPhase,
  type OverlayPhase,
} from './overlay-phase'

describe('OverlayRoot phase machine', () => {
  it('keeps the platform surface mounted until the exit target completes', () => {
    const closing = resolveOverlayPhase(false, 'open')

    expect(closing).toBe('closing')
    expect(isOverlayPresented(closing)).toBe(true)
    expect(overlayAnimationTarget(closing)).toBe('hidden')
    expect(completeOverlayPhase(closing, 'hidden')).toBe('closed')
  })

  it('ignores a stale exit completion after a rapid reopen', () => {
    const reopened = resolveOverlayPhase(true, 'closing')

    expect(reopened).toBe('opening')
    expect(completeOverlayPhase(reopened, 'hidden')).toBe('opening')
    expect(completeOverlayPhase(reopened, 'visible')).toBe('open')
  })

  it.each<[boolean, OverlayPhase, OverlayPhase]>([
    [true, 'closed', 'opening'],
    [true, 'opening', 'opening'],
    [true, 'open', 'open'],
    [false, 'open', 'closing'],
    [false, 'closing', 'closing'],
    [false, 'closed', 'closed'],
  ])('resolves requested=%s from %s to %s', (requested, current, expected) => {
    expect(resolveOverlayPhase(requested, current)).toBe(expected)
  })
})
