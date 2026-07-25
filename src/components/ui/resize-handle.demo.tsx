'use client'

import { useState } from 'react'
import { ResizeHandle } from './resize-handle'

/** ResizeHandle 示例（/playbook 展示单元）。 */
export function ResizeHandleDemo() {
  const [width, setWidth] = useState(240)
  const [dragging, setDragging] = useState(false)

  return (
    <div className="flex h-48 overflow-hidden rounded-md border border-separator">
      <div
        className="flex items-center justify-center bg-glass-sidebar text-[13px] text-label-secondary"
        style={{ width }}
      >
        {width}px
      </div>
      <ResizeHandle
        isDragging={dragging}
        onPointerDown={(event) => {
          setDragging(true)
          const startX = event.clientX
          const startWidth = width
          function onMove(move: PointerEvent) {
            setWidth(Math.min(360, Math.max(160, startWidth + move.clientX - startX)))
          }
          function onUp() {
            setDragging(false)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
        }}
        onKeyAdjust={(delta) => setWidth((current) => Math.min(360, Math.max(160, current + delta)))}
      />
      <div className="flex min-w-0 flex-1 items-center justify-center bg-surface text-[13px] text-label-tertiary">
        主区
      </div>
    </div>
  )
}
