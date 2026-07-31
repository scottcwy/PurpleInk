'use client'

import {
  MiniMap,
  useReactFlow,
  type Node,
} from '@xyflow/react'
import { NODE_HEIGHT, NODE_WIDTH } from '@/features/canvas/layout'
import { miniMapNodeColor } from './flow-elements'

export interface CanvasMiniMapProps {
  onSelectNode: (nodeId: string) => void
}

/**
 * 画布小地图：阶段色可见，拖拽/滚轮导航，点击节点选中并定位主视口。
 */
export function CanvasMiniMap({ onSelectNode }: CanvasMiniMapProps) {
  const { setCenter } = useReactFlow()

  return (
    <MiniMap
      pannable
      zoomable
      nodeColor={miniMapNodeColor}
      nodeStrokeColor={(node) =>
        node.selected ? 'var(--ds-primary)' : 'var(--ds-border)'
      }
      nodeStrokeWidth={3}
      maskColor="color-mix(in srgb, var(--ds-text-muted) 20%, transparent)"
      className="!mb-16 !bg-ds-surface !shadow-[var(--ds-shadow)]"
      onClick={(_event, position) => {
        setCenter(position.x, position.y, { duration: 200 })
      }}
      onNodeClick={(_event, node) => {
        onSelectNode(node.id)
        const { x, y } = nodeCenter(node)
        setCenter(x, y, { duration: 200 })
      }}
    />
  )
}

function nodeCenter(node: Node): { x: number; y: number } {
  const width = node.width ?? node.measured?.width ?? NODE_WIDTH
  const height = node.height ?? node.measured?.height ?? NODE_HEIGHT
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  }
}
