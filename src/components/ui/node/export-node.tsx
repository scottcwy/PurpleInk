import type { ComponentType } from 'react'
import { Film } from 'lucide-react'
import type { NodeStatus } from '@/features/canvas/types'
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

export interface ExportNodeProps {
  title: string
  fileLabel: string
  icon?: ComponentType<{ className?: string }>
  status?: NodeStatus
  className?: string
}

/**
 * 导出节点（SSOT）。
 * canvas.pen: 220 宽、surface 底、rounded-md、1.5px finalize 色描边、shadow-card；
 * 头部 + 文件信息行 + 状态胶囊。
 */
export function ExportNode({
  title,
  fileLabel,
  icon: Icon = Film,
  status = 'pending',
  className,
}: ExportNodeProps) {
  const color = nodeTypeColorToken('export')
  return (
    <div
      className={cn(
        'flex w-[220px] flex-col gap-2 rounded-md border-[1.5px] bg-surface p-3 shadow-card',
        color,
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4 text-stage-finalize')} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold font-sc text-label">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Film className="h-4 w-4 text-label-secondary" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-sc text-label">
          {fileLabel}
        </span>
        <StatusPill variant={STATUS_MAP[status]} />
      </div>
    </div>
  )
}
