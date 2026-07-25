const BRIDGE_PX = 8

/** Whether a pointer leaving a trigger is still heading into the preview panel. */
export function isLeavingTowardPanel(
  leaveX: number,
  leaveY: number,
  velocityX: number,
  velocityY: number,
  panelRect: DOMRect,
  bridge = BRIDGE_PX,
): boolean {
  const expanded = {
    left: panelRect.left - bridge,
    right: panelRect.right + bridge,
    top: panelRect.top - bridge,
    bottom: panelRect.bottom + bridge,
  }

  if (pointInRect(leaveX, leaveY, expanded)) return true

  const speed = Math.hypot(velocityX, velocityY)
  // No meaningful motion: only the bridge gap (above) keeps the panel open.
  if (speed < 0.05) return false

  return rayHitsRect(
    leaveX,
    leaveY,
    velocityX / speed,
    velocityY / speed,
    expanded,
  )
}

function pointInRect(
  x: number,
  y: number,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function rayHitsRect(
  originX: number,
  originY: number,
  ux: number,
  uy: number,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean {
  for (let d = 0; d <= 120; d += 8) {
    if (pointInRect(originX + ux * d, originY + uy * d, rect)) return true
  }
  return false
}
