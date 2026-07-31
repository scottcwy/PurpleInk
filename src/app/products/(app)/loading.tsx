import { Skeleton } from '@/components/ui/skeleton'

/**
 * L3 段级骨架：侧栏由 layout 常驻，此处只撑右侧内容轮廓。
 * Next 在导航等待 page RSC 时自动展示；真实数据到达后即替换，不得常驻。
 */
export default function AppLoading() {
  return (
    <main
      className="min-h-0 flex-1 overflow-y-auto"
      aria-busy="true"
    >
      <span className="sr-only">加载中</span>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-ds-border bg-ds-surface px-4 sm:px-7">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-36" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="flex w-full flex-col gap-6 px-4 py-5 sm:px-7 sm:py-6">
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 rounded-md" />
          <Skeleton className="h-28 rounded-md" />
          <Skeleton className="h-28 rounded-md" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full max-w-3xl rounded-md" />
        </div>
      </div>
    </main>
  )
}
