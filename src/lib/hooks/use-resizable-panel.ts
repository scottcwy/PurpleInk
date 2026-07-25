'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export interface ResizablePanelOptions {
  storageKey: string
  defaultWidth: number
  min: number
  max: number
  /** 右侧面板（handle 在左缘）时为 true：向左拖 = 变宽 */
  invert?: boolean
}

export interface ResizablePanelResult {
  width: number
  isDragging: boolean
  handlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  resetWidth: () => void
  setWidth: (next: number) => void
}

/** 纯函数：按拖拽 delta 计算并夹取宽度，可脱离 DOM 单测。 */
export function clampWidth(
  startWidth: number,
  deltaPx: number,
  min: number,
  max: number,
  invert = false,
): number {
  const signed = invert ? -deltaPx : deltaPx
  return Math.min(max, Math.max(min, startWidth + signed))
}

function readStoredWidth(storageKey: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
  } catch {
    return fallback
  }
}

function writeStoredWidth(storageKey: string, width: number): void {
  try {
    localStorage.setItem(storageKey, String(width))
  } catch {
    // ignore write failures
  }
}

/**
 * 面板拖拽调宽（零依赖 pointer events）。
 * 宽度在松手时写入 localStorage。
 */
export function useResizablePanel({
  storageKey,
  defaultWidth,
  min,
  max,
  invert = false,
}: ResizablePanelOptions): ResizablePanelResult {
  const [width, setWidthState] = useState(defaultWidth)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const stored = readStoredWidth(storageKey, defaultWidth, min, max)
    queueMicrotask(() => setWidthState(stored))
  }, [storageKey, defaultWidth, min, max])

  const setWidth = useCallback(
    (next: number) => {
      const clamped = Math.min(max, Math.max(min, next))
      setWidthState(clamped)
      writeStoredWidth(storageKey, clamped)
    },
    [storageKey, min, max],
  )

  const resetWidth = useCallback(() => {
    setWidth(defaultWidth)
  }, [defaultWidth, setWidth])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      dragRef.current = { startX: event.clientX, startWidth: width }
      setIsDragging(true)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [width],
  )

  useEffect(() => {
    if (!isDragging) return

    function onMove(event: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      const next = clampWidth(drag.startWidth, event.clientX - drag.startX, min, max, invert)
      setWidthState(next)
    }

    function onUp() {
      const drag = dragRef.current
      dragRef.current = null
      setIsDragging(false)
      if (!drag) return
      // width 已在 move 中更新；从当前 state 取不到最新值时，用最后一次 move 的结果写盘
      setWidthState((current) => {
        writeStoredWidth(storageKey, current)
        return current
      })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [isDragging, invert, max, min, storageKey])

  return { width, isDragging, handlePointerDown, resetWidth, setWidth }
}
