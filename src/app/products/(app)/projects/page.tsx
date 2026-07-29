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
        kind: project.kind,
        title: project.title,
        href: productCanvasHref(project.id),
        meta: projectMeta(project.kind, shots.length, project.updatedAt),
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
          <ProjectList
            projects={summaries}
            authoredEmptyAction={<NewProjectDialog initialKind="script" />}
            websiteEmptyAction={<NewProjectDialog initialKind="website" />}
          />
        </div>
      </main>
    </>
  )
}

function projectMeta(
  kind: ProjectSummary['kind'],
  shotCount: number,
  updatedAt: Date,
): string {
  const updated = updatedAt.toLocaleString('zh-CN')
  if (kind === 'website') return `网站介绍 · ${updated}`
  const source = kind === 'audio' ? '原录音' : '文稿'
  return `${source} · ${shotCount} 个镜头 · ${updated}`
}
