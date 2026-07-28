import { NewProjectDialog } from '@/app/_components/new-project-dialog'
import { TopBar } from '@/components/ui/top-bar'
import { withPageSession } from '@/features/auth/page-session'
import { getCanvasGraph, listProjects } from '@/features/canvas'
import { PublishNavContext } from '@/features/navigation/nav-context'
import { productCanvasHref } from '@/features/navigation/products-routes'
import {
  ProjectList,
  type ProjectSummary,
} from '@/features/projects/project-list'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  return withPageSession('/products/projects', renderProjects)
}

async function renderProjects() {
  const projects = await listProjects()
  const graphEntries = await Promise.all(
    projects.map(async (project) => [
      project.id,
      await getCanvasGraph(project.id),
    ] as const),
  )
  const graphs = new Map(graphEntries)
  const summaries = projects.map((project): ProjectSummary => {
      const graph = graphs.get(project.id) ?? { nodes: [], edges: [] }
      const shots = graph.nodes.filter((node) => node.type === 'shot-codegen')
      const hasFailure = graph.nodes.some((node) => node.status === 'failed')
      const hasActive = graph.nodes.some(
        (node) => node.status === 'pending' || node.status === 'running',
      )
      const complete =
        graph.nodes.length > 0 &&
        graph.nodes.every((node) => node.status === 'success')
      return {
        id: project.id,
        title: project.title,
        href: productCanvasHref(project.id),
        meta: `${shots.length} 个镜头 · ${project.updatedAt.toLocaleString('zh-CN')}`,
        status: hasFailure
          ? 'failed'
          : hasActive
            ? 'generating'
            : complete
              ? 'rendered'
              : 'pending',
      }
    })
  const firstProject = projects[0]
  const firstGraph = firstProject ? graphs.get(firstProject.id) : undefined
  const firstShot = firstGraph?.nodes.find((node) => node.type === 'shot-codegen')

  return (
    <>
      <PublishNavContext
        projectId={firstProject?.id}
        rendererNodeId={firstShot?.id}
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <TopBar
          title="项目"
          meta={`共 ${projects.length} 个真实项目`}
          actions={<NewProjectDialog />}
        />
        <div className="mx-auto flex max-w-[1160px] flex-col gap-6 p-5 sm:p-8">
          {projects.length > 0 ? (
            <ProjectList projects={summaries} />
          ) : (
            <div className="ds-dot-grid flex min-h-80 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ds-border text-center">
              <h1 className="text-lg font-semibold">还没有项目</h1>
              <p className="text-sm text-ds-text-muted">
                创建项目后会保存真实源文本，并启动 INGEST Pipeline。
              </p>
              <NewProjectDialog />
            </div>
          )}
        </div>
      </main>
    </>
  )
}
