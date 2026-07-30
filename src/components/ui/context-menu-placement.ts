/** 指针锚定坐标（视口坐标系，等价于 MouseEvent 的 clientX / clientY）。 */
export interface ContextMenuPosition {
  x: number
  y: number
}

export interface ContextMenuBox {
  width: number
  height: number
}

/** 菜单落位结果；origin 供 scale 动画取一致的变换原点。 */
export interface ContextMenuPlacement {
  top: number
  left: number
  originX: 'left' | 'right'
  originY: 'top' | 'bottom'
}

/** 菜单与视口边缘的最小间距，避免贴边导致圆角与阴影被裁。 */
export const CONTEXT_MENU_VIEWPORT_MARGIN = 8

/**
 * 把指针坐标解析为不溢出视口的菜单落位。
 *
 * 优先向右下展开；某一侧空间不足时翻转到指针另一侧，翻转后仍不足则钳到边距内。
 * 菜单尺寸由调用方实测传入（不写死宽高），因此菜单项增减不会让判断失准。
 */
export function resolveContextMenuPlacement(
  position: ContextMenuPosition,
  menu: ContextMenuBox,
  viewport: ContextMenuBox,
): ContextMenuPlacement {
  const horizontal = resolveAxis(position.x, menu.width, viewport.width)
  const vertical = resolveAxis(position.y, menu.height, viewport.height)
  return {
    left: horizontal.start,
    top: vertical.start,
    originX: horizontal.flipped ? 'right' : 'left',
    originY: vertical.flipped ? 'bottom' : 'top',
  }
}

function resolveAxis(
  pointer: number,
  size: number,
  viewport: number,
): { start: number; flipped: boolean } {
  const margin = CONTEXT_MENU_VIEWPORT_MARGIN
  const overflowsForward = pointer + size + margin > viewport
  const flipped = overflowsForward && pointer - size - margin >= 0
  const start = flipped ? pointer - size : pointer
  const max = Math.max(margin, viewport - size - margin)
  return { start: Math.min(Math.max(start, margin), max), flipped }
}
