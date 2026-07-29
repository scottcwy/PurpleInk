import { NewProjectDialog } from '@/app/_components/new-project-dialog'
import { ProjectStatisticsPanel } from '@/components/ui/project-statistics-panel'
import { RecentProjectsPanel } from '@/components/ui/recent-projects-panel'
import { TopBar } from '@/components/ui/top-bar'
import { withPageSession } from '@/features/auth/page-session'
import { getBillingProjection } from '@/features/billing'
import { BillingDashboardUsage } from '@/features/billing/ui/usage-panels'
import type { BillingUiProjection } from '@/features/billing/ui/projection-contract'
import { getCanvasGraph, listProjects } from '@/features/canvas'
import { buildProductsDashboardView } from '@/features/dashboard/products-dashboard-view-model'
import { PublishNavContext } from '@/features/navigation/nav-context'
import {
  getAiUsageProjection,
  type AiUsageProjectionV1,
  type AiUsageRange,
  type AiUsageView,
} from '@/features/usage'

export const dynamic = 'force-dynamic'

/** proxy 只按 cookie 形状拦；真实会话校验与归属上下文在 `withPageSession` 内。 */
export default async function ProductsDashboardPage() {
  return withPageSession('/products/dashboard', renderDashboard)
}

async function renderDashboard(session: { userId: string }) {
  const [projects, billing, accountUsage, managedUsage] = await Promise.all([
    listProjects(),
    getBillingProjection(),
    optionalUsage(session.userId, 'account', '7d'),
    optionalUsage(session.userId, 'managed-cycle', 'cycle'),
  ])
  const billingProjection: BillingUiProjection = billing
  const graphEntries = await Promise.all(
    projects.map(async (project) => [
      project.id,
      await getCanvasGraph(project.id),
    ] as const),
  )
  const graphs = new Map(graphEntries)
  const dashboard = buildProductsDashboardView(projects, graphs)
  const currentProject = dashboard.recentProjects[0]
  const currentGraph = currentProject ? graphs.get(currentProject.id) : undefined
  const currentShot = currentGraph?.nodes.find((node) => node.type === 'shot-codegen')

  return (
    <>
      <PublishNavContext
        projectId={currentProject?.id}
        rendererNodeId={currentShot?.id}
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <TopBar
          title="工作台"
          meta="本地项目与 Pipeline 运行概览"
          actions={<NewProjectDialog />}
        />
        <div className="flex w-full flex-col gap-6 px-4 py-5 sm:px-7 sm:py-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">统计</h1>
              <p className="mt-1 text-xs text-ds-text-muted">
                查看真实项目、Pipeline 与 Artifact 当前快照。
              </p>
            </div>
            <p className="text-xs text-ds-text-muted">{dashboard.updatedLabel}</p>
          </header>
          <BillingDashboardUsage
            projection={billingProjection}
            usageProjection={managedUsage}
          />
          <ProjectStatisticsPanel
            metrics={dashboard.metrics}
            statusDistribution={dashboard.statusDistribution}
            trendUnavailableLabel="尚无历史快照可绘制"
            updatedLabel={dashboard.updatedLabel}
            apiUsage={accountUsage}
          />
          <RecentProjectsPanel projects={dashboard.recentProjects.slice(0, 3)} />
        </div>
      </main>
    </>
  )
}

async function optionalUsage(
  userId: string,
  view: AiUsageView,
  range: AiUsageRange,
): Promise<AiUsageProjectionV1 | null> {
  try {
    return await getAiUsageProjection({
      userId,
      view,
      range,
      timeZone: 'UTC',
    })
  } catch {
    return null
  }
}
