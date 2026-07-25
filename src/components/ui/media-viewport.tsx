import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

export interface MediaViewportProps {
  children?: ReactNode
  loading?: boolean
  placeholder?: ReactNode
  className?: string
}

/** 统一视频、固定画布预览及其占位/加载态的 16:9 媒体表面。 */
export function MediaViewport({
  children,
  loading = false,
  placeholder,
  className,
}: MediaViewportProps) {
  return (
    <div
      data-slot="media-viewport"
      aria-busy={loading || undefined}
      className={cn(
        'relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-player-bg',
        className
      )}
    >
      {loading ? <Skeleton className="absolute inset-0 h-full w-full" /> : children ?? placeholder}
    </div>
  )
}
