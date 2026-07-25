import { TopBar } from '@/components/ui/top-bar'
import { UnwiredPanel, type UnwiredPanelProps } from './unwired-panel'

export interface RouteShellPageProps extends UnwiredPanelProps {
  /** 顶栏右侧的元信息，说明该路由在整体规划中的位置。 */
  meta: string
}

/**
 * 未接线路由的整页壳（C 层组合）。
 *
 * 顶栏复用已登记的 `TopBar`，正文复用 `UnwiredPanel`，不引入平行的页头
 * 或卡片视觉（design-system-inventory §5）。
 */
export function RouteShellPage({
  title,
  meta,
  description,
  sources,
  futureGuard,
}: RouteShellPageProps) {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <TopBar title={title} meta={meta} />
      <div className="mx-auto w-full max-w-6xl p-5 sm:p-8">
        <UnwiredPanel
          title={title}
          description={description}
          sources={sources}
          futureGuard={futureGuard}
        />
      </div>
    </main>
  )
}
