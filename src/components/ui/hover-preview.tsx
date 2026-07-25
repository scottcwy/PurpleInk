'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { isLeavingTowardPanel } from './hover-preview-geometry'

export interface HoverPreviewProps {
  trigger: ReactNode
  children: ReactNode
  /** Accessible label for the preview dialog. */
  label?: string
  className?: string
  contentClassName?: string
  openDelayMs?: number
  closeDelayMs?: number
  fadeMs?: number
}

const OPEN_DELAY_MS = 80
const CLOSE_DELAY_MS = 150
const FADE_MS = 120
const BRIDGE_PX = 8
const VIEWPORT_PAD = 16

const subscribeToClient = () => () => undefined

type Coords = { top: number; left: number; placement: 'below' | 'above' }

/**
 * 悬停预览壳（SSOT）。
 * 无全屏 dismiss；支持触发器↔面板桥接，离开方向不朝面板时渐隐关闭。
 */
export function HoverPreview({
  trigger,
  children,
  label = '预览',
  className,
  contentClassName,
  openDelayMs = OPEN_DELAY_MS,
  closeDelayMs = CLOSE_DELAY_MS,
  fadeMs = FADE_MS,
}: HoverPreviewProps) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, t: 0 })

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)

  const clientMounted = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  )

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    openTimerRef.current = null
    closeTimerRef.current = null
    fadeTimerRef.current = null
  }, [])

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current
    const panel = panelRef.current
    if (!triggerEl) return

    const triggerRect = triggerEl.getBoundingClientRect()
    const panelWidth = panel?.offsetWidth ?? 420
    const panelHeight = panel?.offsetHeight ?? 160
    const spaceBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_PAD
    const placement: Coords['placement'] =
      spaceBelow < Math.min(panelHeight, 160) && triggerRect.top > spaceBelow
        ? 'above'
        : 'below'

    let left = triggerRect.left
    left = Math.min(left, window.innerWidth - panelWidth - VIEWPORT_PAD)
    left = Math.max(VIEWPORT_PAD, left)

    const top =
      placement === 'below'
        ? triggerRect.bottom + BRIDGE_PX
        : triggerRect.top - BRIDGE_PX - panelHeight

    setCoords({
      top: Math.max(VIEWPORT_PAD, top),
      left,
      placement,
    })
  }, [])

  const open = useCallback(() => {
    clearTimers()
    setMounted(true)
    requestAnimationFrame(() => {
      updatePosition()
      setVisible(true)
    })
  }, [clearTimers, updatePosition])

  const scheduleOpen = useCallback(() => {
    clearTimers()
    openTimerRef.current = setTimeout(open, openDelayMs)
  }, [clearTimers, open, openDelayMs])

  const closeNow = useCallback(() => {
    clearTimers()
    setVisible(false)
    fadeTimerRef.current = setTimeout(() => {
      setMounted(false)
      setCoords(null)
    }, fadeMs)
  }, [clearTimers, fadeMs])

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(closeNow, closeDelayMs)
  }, [closeDelayMs, closeNow])

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    fadeTimerRef.current = null
    if (mounted) setVisible(true)
  }, [mounted])

  useLayoutEffect(() => {
    if (!mounted) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [mounted, updatePosition, children])

  useEffect(() => () => clearTimers(), [clearTimers])

  function trackPointer(event: ReactPointerEvent) {
    const now = performance.now()
    const prev = pointerRef.current
    const dt = Math.max(now - prev.t, 1)
    pointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      vx: ((event.clientX - prev.x) / dt) * 16,
      vy: ((event.clientY - prev.y) / dt) * 16,
      t: now,
    }
  }

  function handleTriggerLeave(event: ReactPointerEvent) {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }

    const related = event.relatedTarget
    if (related instanceof Node && panelRef.current?.contains(related)) {
      cancelClose()
      return
    }

    const panelRect = panelRef.current?.getBoundingClientRect()
    const pointer = pointerRef.current
    if (
      panelRect &&
      isLeavingTowardPanel(pointer.x, pointer.y, pointer.vx, pointer.vy, panelRect)
    ) {
      cancelClose()
      scheduleClose()
      return
    }

    scheduleClose()
  }

  return (
    <div
      ref={triggerRef}
      className={cn('relative inline-flex', className)}
      onPointerEnter={() => {
        cancelClose()
        scheduleOpen()
      }}
      onPointerMove={trackPointer}
      onPointerLeave={handleTriggerLeave}
    >
      {trigger}
      {mounted && clientMounted
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={label}
              aria-modal="false"
              onPointerEnter={cancelClose}
              onPointerLeave={scheduleClose}
              className={cn(
                'fixed z-[1001] w-[min(100%,420px)] max-w-[calc(100vw-2rem)] rounded-[10px] border border-ds-border bg-ds-surface p-3 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl transition-opacity',
                visible ? 'opacity-100' : 'opacity-0',
                contentClassName,
              )}
              style={{
                top: coords?.top ?? -9999,
                left: coords?.left ?? -9999,
                transitionDuration: `${fadeMs}ms`,
                pointerEvents: visible ? 'auto' : 'none',
              }}
            >
              <div className="max-h-[min(320px,calc(100vh-4rem))] overflow-y-auto">
                {children}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
