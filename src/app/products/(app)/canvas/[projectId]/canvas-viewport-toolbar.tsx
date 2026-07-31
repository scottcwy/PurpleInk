'use client'

import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { Panel, useReactFlow, useStore } from '@xyflow/react'
import { IconButton } from '@/components/ui/icon-button'

/**
 * 画布视口工具条：底中横向放大 / 缩小 / 适应视图。
 * 只做视口导航；流水线、导出、泳道折叠留在各自区域。
 */
export function CanvasViewportToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const minZoomReached = useStore((state) => state.transform[2] <= state.minZoom)
  const maxZoomReached = useStore((state) => state.transform[2] >= state.maxZoom)

  return (
    <Panel position="bottom-center" className="mx-3 mt-3 mb-16">
      <div
        role="toolbar"
        aria-label="画布视口"
        className="flex items-center gap-1 rounded-md border border-ds-border bg-ds-surface p-1"
      >
        <IconButton
          icon={ZoomIn}
          title="放大"
          aria-label="放大"
          disabled={maxZoomReached}
          onClick={() => zoomIn({ duration: 200 })}
        />
        <IconButton
          icon={ZoomOut}
          title="缩小"
          aria-label="缩小"
          disabled={minZoomReached}
          onClick={() => zoomOut({ duration: 200 })}
        />
        <IconButton
          icon={Maximize2}
          title="适应视图"
          aria-label="适应视图"
          onClick={() => fitView({ padding: 0.15, duration: 200 })}
        />
      </div>
    </Panel>
  )
}
