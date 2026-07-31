'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { cn } from '@/lib/utils'
import {
  resolveContextMenuPlacement,
  type ContextMenuPlacement,
  type ContextMenuPosition,
} from './context-menu-placement'
import { focusFirstMenuItem, moveMenuFocus } from './menu-focus'
import { OverlayRoot } from './overlay-root'

export type { ContextMenuPosition } from './context-menu-placement'

export interface ContextMenuAction {
  type?: 'action'
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  disabled?: boolean
  /** 禁用原因；渲染为次级文本，保证状态不只靠颜色表达（pitfalls §1.5）。 */
  disabledReason?: string
  /** 高代价操作（删除类）：red 前景 + 图标双重语义。 */
  danger?: boolean
  onSelect: () => void
}

export interface ContextMenuSeparator {
  type: 'separator'
  id: string
}

export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator

export interface ContextMenuProps {
  open: boolean
  /** 指针锚定坐标；为 null 时不渲染。 */
  position: ContextMenuPosition | null
  items: readonly ContextMenuItem[]
  onClose: () => void
  ariaLabel: string
  className?: string
}

/**
 * 指针锚定的上下文菜单（SSOT：全应用右键菜单统一从此处 import）。
 *
 * 与 `Popover` 的区别是锚定模型：Popover 锚在 trigger 元素的 bounding rect，
 * 本组件锚在指针坐标，因此不能互相替代。原生 Popover 负责 top layer 与 dismiss。
 *
 * 动效按 motion-interaction.md §3 意图 8：scale spring + opacity tween；
 * 退出走 `TRANSITION_EXIT`（§5.3 退出不弹）。
 */
export function ContextMenu({
  open,
  position,
  items,
  onClose,
  ariaLabel,
  className,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const restoreOnCloseRef = useRef(false)
  const [placement, setPlacement] = useState<ContextMenuPlacement | null>(null)

  useMenuPlacement({ open, position, menuRef, itemCount: items.length, setPlacement })
  useInitialItemFocus(open, menuRef, restoreFocusRef, restoreOnCloseRef)

  const moveFocus = useCallback((offset: number) => {
    moveMenuFocus(menuRef.current, offset)
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      restoreOnCloseRef.current = true
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    moveFocus(event.key === 'ArrowDown' ? 1 : -1)
  }

  return (
    <OverlayRoot
      mode="popover"
      dismissal="auto"
      open={open && position !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      surfaceRef={menuRef}
      role="menu"
      ariaLabel={ariaLabel}
      tabIndex={-1}
      style={{
        top: placement?.top ?? position?.y ?? 0,
        left: placement?.left ?? position?.x ?? 0,
        transformOrigin: `${placement?.originY ?? 'top'} ${placement?.originX ?? 'left'}`,
      }}
      className={cn(
        'fixed min-w-[184px] max-w-[calc(100vw-1rem)] rounded-[10px] border border-ds-border bg-ds-surface p-1 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl',
        className,
      )}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) =>
        item.type === 'separator' ? (
          <div key={item.id} role="separator" className="my-1 h-px bg-ds-border" />
        ) : (
          <ContextMenuButton
            key={item.id}
            item={item}
            onClose={onClose}
            restoreFocus={() => {
              restoreOnCloseRef.current = true
            }}
          />
        ),
      )}
    </OverlayRoot>
  )
}

function ContextMenuButton({
  item,
  onClose,
  restoreFocus,
}: {
  item: ContextMenuAction
  onClose: () => void
  restoreFocus: () => void
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item
      disabled={item.disabled}
      title={item.disabled ? item.disabledReason : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-fast ease-standard hover:bg-ds-surface-muted focus-visible:bg-ds-surface-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45',
        item.danger ? 'text-ds-red' : 'text-ds-text',
      )}
      onClick={() => {
        restoreFocus()
        onClose()
        item.onSelect()
      }}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.disabled && item.disabledReason && (
        <span className="shrink-0 text-[11px] text-ds-text-muted">
          {item.disabledReason}
        </span>
      )}
    </button>
  )
}

/** 实测菜单尺寸后在 layout 阶段落位，避免用写死宽高判断溢出。 */
function useMenuPlacement({
  open,
  position,
  menuRef,
  itemCount,
  setPlacement,
}: {
  open: boolean
  position: ContextMenuPosition | null
  menuRef: RefObject<HTMLDivElement | null>
  itemCount: number
  setPlacement: (placement: ContextMenuPlacement) => void
}) {
  useLayoutEffect(() => {
    if (!open || !position) return
    const frame = requestAnimationFrame(() => {
      const rect = menuRef.current?.getBoundingClientRect()
      if (!rect) return
      setPlacement(
        resolveContextMenuPlacement(
          position,
          { width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      )
    })
    // itemCount 进入依赖：菜单项增减会改变高度，须重新落位。
    return () => cancelAnimationFrame(frame)
  }, [open, position, itemCount, menuRef, setPlacement])
}

/** 打开时把焦点移到首个可用项，让键盘用户无需再按方向键定位。 */
function useInitialItemFocus(
  open: boolean,
  menuRef: RefObject<HTMLDivElement | null>,
  restoreFocusRef: RefObject<HTMLElement | null>,
  restoreOnCloseRef: RefObject<boolean>,
) {
  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    restoreFocusRef.current = active instanceof HTMLElement ? active : null
    const frame = requestAnimationFrame(() => focusFirstMenuItem(menuRef.current))
    return () => {
      cancelAnimationFrame(frame)
      if (restoreOnCloseRef.current) restoreFocusRef.current?.focus()
      restoreOnCloseRef.current = false
      restoreFocusRef.current = null
    }
  }, [menuRef, open, restoreFocusRef, restoreOnCloseRef])
}
