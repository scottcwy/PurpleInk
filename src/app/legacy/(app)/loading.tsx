import { Skeleton } from '@/components/ui/skeleton'

/**
 * (app) 路由段的加载骨架。仅替换右侧内容区，侧栏由常驻 layout 保持。
 * 页面多为同步数据，主要在导航 / RSC 流式期间短暂出现。
 */
export default function AppLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-8">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-40" />
        ))}
      </div>
    </div>
  )
}
