import { NewProjectDialog } from '@/app/_components/new-project-dialog'
import { ProjectStatisticsPanel } from '@/components/ui/project-statistics-panel'
import { RecentProjectsPanel } from '@/components/ui/recent-projects-panel'
import { TopBar } from '@/components/ui/top-bar'
import { getCanvasGraph, listProjects } from '@/features/canvas'
import { buildProductsDashboardView } from '@/features/dashboard/products-dashboard-view-model'
import { PublishNavContext } from '@/features/navigation/nav-context'

export const dynamic = 'force-dynamic'

export default async function ProductsDashboardPage() {
  const projects = await listProjects()
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
        <div className="mx-auto flex max-w-[1280px] flex-col gap-[18px] p-5 sm:p-8">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[28px] font-bold tracking-[-0.03em]">统计</h1>
              <p className="mt-1 text-xs text-ds-text-muted">
                查看真实项目、Pipeline 与 Artifact 当前快照。
              </p>
            </div>
            <p className="text-[11px] text-ds-text-muted">{dashboard.updatedLabel}</p>
          </header>
          <ProjectStatisticsPanel
            metrics={dashboard.metrics}
            statusDistribution={dashboard.statusDistribution}
            trendUnavailableLabel="暂无可用历史快照"
            updatedLabel={dashboard.updatedLabel}
          />
          <RecentProjectsPanel projects={dashboard.recentProjects.slice(0, 3)} />
        </div>
      </main>
    </>
  )
}
