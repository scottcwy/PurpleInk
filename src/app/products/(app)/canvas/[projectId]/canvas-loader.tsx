'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'
import { MobileFallbackCard } from '@/features/navigation/mobile-fallback-card'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { BP_SIDEBAR_HIDDEN } from '@/lib/layout/breakpoints'
import type { CanvasViewProps } from './canvas-view'

/** 画布加载骨架：与运行态一致，不预留常驻顶栏高度。 */
function CanvasSkeleton() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-ds-canvas text-ds-text">
      <div aria-hidden className="absolute inset-x-0 top-0 z-30 h-4" />
      <div className="min-h-0 flex-1 p-10">
        <div className="grid max-w-4xl grid-cols-3 gap-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  )
}

const CanvasView = dynamic(
  () => import('./canvas-view').then((module) => module.CanvasView),
  {
    ssr: false,
    loading: () => <CanvasSkeleton />,
  }
)

export function CanvasLoader(props: CanvasViewProps) {
  // SSR / 首帧默认 false（与 app-sidebar-shell 同策略），先出画布骨架，避免水合闪烁。
  const isMobile = useMediaQuery(`(max-width: ${BP_SIDEBAR_HIDDEN - 1}px)`)
  if (isMobile) {
    return <MobileFallbackCard />
  }
  return <CanvasView {...props} />
}
