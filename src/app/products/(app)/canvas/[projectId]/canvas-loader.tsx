'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'
import type { CanvasViewProps } from './canvas-view'

/** 画布加载骨架：撑出顶栏 + 节点区轮廓，替代无信息的“正在加载画布…”。 */
function CanvasSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-ds-canvas text-ds-text">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-ds-border bg-ds-surface px-7">
        <Skeleton className="h-5 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
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
  return <CanvasView {...props} />
}
