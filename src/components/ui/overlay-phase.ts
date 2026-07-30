export type OverlayPhase = 'closed' | 'opening' | 'open' | 'closing'
export type OverlayAnimationTarget = 'hidden' | 'visible'

export function resolveOverlayPhase(
  requestedOpen: boolean,
  current: OverlayPhase,
): OverlayPhase {
  if (requestedOpen) {
    return current === 'closed' || current === 'closing' ? 'opening' : current
  }
  return current === 'open' || current === 'opening' ? 'closing' : current
}

export function completeOverlayPhase(
  current: OverlayPhase,
  completedTarget: OverlayAnimationTarget,
): OverlayPhase {
  if (current === 'opening' && completedTarget === 'visible') return 'open'
  if (current === 'closing' && completedTarget === 'hidden') return 'closed'
  return current
}

export function overlayAnimationTarget(phase: OverlayPhase): OverlayAnimationTarget {
  return phase === 'opening' || phase === 'open' ? 'visible' : 'hidden'
}

export function isOverlayPresented(phase: OverlayPhase): boolean {
  return phase !== 'closed'
}
