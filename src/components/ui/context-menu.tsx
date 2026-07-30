'use client'

import { AnimatePresence, motion } from 'motion/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { DURATION, EASE, SPRING_SPATIAL_FAST, TRANSITION_EXIT } from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'
import {
  resolveContextMenuPlacement,
  type ContextMenuPlacement,
  type ContextMenuPosition,
} from './context-menu-placement'

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

const subscribeToClient = () => () => undefined
const ITEM_SELECTOR = 'button[data-menu-item]:not([disabled])'

/**
 * 指针锚定的上下文菜单（SSOT：全应用右键菜单统一从此处 import）。
 *
 * 与 `Popover` 的区别是锚定模型：Popover 锚在 trigger 元素的 bounding rect，
 * 本组件锚在指针坐标，因此不能互相替代。内容 portal 到 document.body。
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
  const mounted = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  )
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<ContextMenuPlacement | null>(null)

  useMenuPlacement({ open, position, menuRef, itemCount: items.length, setPlacement })
  useMenuDismiss(open, onClose, menuRef)
  useInitialItemFocus(open, menuRef)

  const moveFocus = useCallback((offset: number) => {
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? []),
    ]
    if (buttons.length === 0) return
    const current = buttons.findIndex((button) => button === document.activeElement)
    const next = (current + offset + buttons.length) % buttons.length
    buttons[next]?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    moveFocus(event.key === 'ArrowDown' ? 1 : -1)
  }

  if (!mounted || !position) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="context-menu"
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          data-slot="context-menu"
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1, transition: TRANSITION_EXIT }}
          transition={{
            scale: SPRING_SPATIAL_FAST,
            opacity: { duration: DURATION.fast, ease: EASE.standard },
          }}
          style={{
            top: placement?.top ?? position.y,
            left: placement?.left ?? position.x,
            transformOrigin: `${placement?.originY ?? 'top'} ${placement?.originX ?? 'left'}`,
          }}
          className={cn(
            'fixed z-[1001] min-w-[184px] max-w-[calc(100vw-1rem)] rounded-[10px] border border-ds-border bg-ds-surface p-1 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl',
            className,
          )}
          onKeyDown={handleKeyDown}
          onContextMenu={(event) => event.preventDefault()}
        >
          {items.map((item) =>
            item.type === 'separator' ? (
              <div
                key={item.id}
                role="separator"
                className="my-1 h-px bg-ds-border"
              />
            ) : (
              <ContextMenuButton key={item.id} item={item} onClose={onClose} />
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function ContextMenuButton({
  item,
  onClose,
}: {
  item: ContextMenuAction
  onClose: () => void
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
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setPlacement(
      resolveContextMenuPlacement(
        position,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
    // itemCount 进入依赖：菜单项增减会改变高度，须重新落位。
  }, [open, position, itemCount, menuRef, setPlacement])
}

/** light dismiss：外部指针、Escape、Tab、滚动、resize 与窗口失焦都关闭。 */
function useMenuDismiss(
  open: boolean,
  onClose: () => void,
  menuRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' && event.key !== 'Tab') return
      event.preventDefault()
      onClose()
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [open, onClose, menuRef])
}

/** 打开时把焦点移到首个可用项，让键盘用户无需再按方向键定位。 */
function useInitialItemFocus(
  open: boolean,
  menuRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return
    const restore = document.activeElement
    menuRef.current?.querySelector<HTMLButtonElement>(ITEM_SELECTOR)?.focus()
    return () => {
      if (restore instanceof HTMLElement) restore.focus()
    }
  }, [open, menuRef])
}
