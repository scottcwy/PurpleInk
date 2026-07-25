import { Skeleton } from './skeleton'

/** Skeleton 示例（/playbook 展示单元）。 */
export function SkeletonDemo() {
  return (
    <div className="flex w-72 items-center gap-3">
      <Skeleton circle className="h-10 w-10" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}
