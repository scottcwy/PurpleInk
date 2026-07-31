'use client'

import { useEffect, useRef, useState } from 'react'
import { MASTER_HEIGHT, MASTER_WIDTH } from '@/features/canvas/export-settings'

interface ContainerSize {
  width: number
  height: number
}

export function fitFixedCanvas(container: ContainerSize) {
  const scale = Math.min(
    container.width / MASTER_WIDTH,
    container.height / MASTER_HEIGHT
  )
  return {
    scale,
    width: MASTER_WIDTH * scale,
    height: MASTER_HEIGHT * scale,
  }
}

export function FixedCanvasIframe({ src }: { src: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<ContainerSize>({
    width: 0,
    height: 0,
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = ({ width, height }: DOMRectReadOnly) => {
      setContainer({ width, height })
    }
    update(host.getBoundingClientRect())
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const fitted = fitFixedCanvas(container)
  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <iframe
        title="确定性分镜预览"
        src={src}
        sandbox="allow-scripts"
        width={MASTER_WIDTH}
        height={MASTER_HEIGHT}
        className="absolute left-0 top-0 border-0"
        style={{
          width: MASTER_WIDTH,
          height: MASTER_HEIGHT,
          transform: `scale(${fitted.scale})`,
          transformOrigin: '0 0',
          visibility: fitted.scale > 0 ? 'visible' : 'hidden',
        }}
      />
    </div>
  )
}
