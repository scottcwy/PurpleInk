import type { ReactNode } from 'react'
import { Ellipsis, Play, RefreshCw } from 'lucide-react'
import type { CanvasNodeType, NodeStatus } from '@/features/canvas/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { StatusPill } from '@/components/ui/status-pill'
import { nodeTypeColorToken } from './stage-colors'

const STATUS_MAP: Record<NodeStatus, 'pending' | 'generating' | 'rendered' | 'stale' | 'failed'> = {
  idle: 'pending',
  pending: 'pending',
  running: 'generating',
  success: 'rendered',
  failed: 'failed',
  cancelled: 'failed',
  stale: 'stale',
}

type ShotNodeType = Extract<CanvasNodeType, 'shot-script' | 'shot-codegen'>

export interface ShotNodeProps {
  nodeType?: ShotNodeType
  title: string
  meta: string
  duration: string
  status?: NodeStatus
  ops?: ReactNode
  cachedLabel?: string
  onRerender?: () => void
  className?: string
}

/**
 * 分镜节点（SSOT）。
 * canvas.pen: 240×260、surface 底、rounded-md、1.5px 阶段色描边、shadow-card；
 * 上半 128px 预览区 + 信息区。
 */
export function ShotNode({
  nodeType = 'shot-codegen',
  title,
  meta,
  duration,
  status = 'pending',
  ops,
  cachedLabel = '已缓存',
  onRerender,
  className,
}: ShotNodeProps) {
  const color = nodeTypeColorToken(nodeType)
  const actions = ops === undefined ? (
    <>
      <Button
        type="button"
        variant="tinted"
        icon={RefreshCw}
        onClick={onRerender}
      >
        重渲此镜
      </Button>
      <span className="text-xs font-sc text-label-tertiary">{cachedLabel}</span>
    </>
  ) : ops
  return (
    <div
      className={cn(
        'relative flex h-[260px] w-[240px] flex-col rounded-md border-[1.5px] bg-surface shadow-card',
        color,
        className,
      )}
    >
      <div className="relative flex h-32 items-center justify-center rounded-t-md bg-fill">
        <Play className="h-6 w-6 text-label-tertiary" />
        <div className="absolute left-2 top-2">
          <StatusPill variant={STATUS_MAP[status]} />
        </div>
        <div className="absolute bottom-2 right-2 rounded px-1.5 py-0.5 text-[11px] font-sc text-text-inverse bg-overlay">
          {duration}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold font-sc text-label">
            {title}
          </span>
          <Ellipsis className="h-4 w-4 text-label-tertiary" />
        </div>
        <span className="text-xs font-mono text-label-tertiary">{meta}</span>
        {actions && <div className="mt-auto flex items-center gap-2">{actions}</div>}
      </div>
      <div
        className={cn(
          'absolute -left-1 top-[126px] h-2 w-2 -translate-y-1/2 rounded-full border-[1.5px] bg-surface',
          color,
        )}
      />
      <div
        className={cn(
          'absolute -right-1 top-[126px] h-2 w-2 -translate-y-1/2 rounded-full border-[1.5px] bg-surface',
          color,
        )}
      />
    </div>
  )
}
