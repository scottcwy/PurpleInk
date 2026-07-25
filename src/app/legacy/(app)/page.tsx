import Link from 'next/link'
import { Film } from 'lucide-react'
import { NewProjectDialog } from '@/app/_components/new-project-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ProjectCard } from '@/components/ui/project-card'
import { SearchField } from '@/components/ui/search-field'
import { getCanvasGraph, listProjects } from '@/features/canvas'
import { PublishNavContext } from '@/features/navigation/nav-context'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const projects = await listProjects()
  const projectCards = await Promise.all(projects.map(async (project) => {
    const nodes = (await getCanvasGraph(project.id)).nodes
    const lanes = new Set(nodes.flatMap((node) => node.laneKey ? [node.laneKey] : []))
    const codeNodes = nodes.filter((node) => node.type === 'shot-codegen')
    const rendered = codeNodes.length > 0 && codeNodes.every((node) => node.status === 'success')
    return {
      ...project,
      laneCount: lanes.size,
      rendererNodeId: codeNodes[0]?.id,
      status: rendered ? 'rendered' as const : 'pending' as const,
    }
  }))

  return (
    <>
      <PublishNavContext
        projectId={projectCards[0]?.id}
        rendererNodeId={projectCards[0]?.rendererNodeId}
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex h-[179px] flex-col items-center justify-center gap-4 px-4 text-center sm:px-10 lg:px-20">
          <h1 className="text-[34px] font-bold leading-tight">把一段稿子，变成一支专业视频</h1>
          <p className="text-[15px] text-label-secondary">
            语义分镜 · 节点画布 · 逐镜代码视频 · 本机一键导出
          </p>
          <NewProjectDialog />
        </section>

        <section className="h-24 px-4 sm:px-10 lg:px-20">
          <NewProjectDialog featured />
        </section>

        <section className="px-4 py-8 sm:px-10 lg:px-20">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[22px] font-semibold">我的项目</h2>
            <SearchField aria-label="搜索项目" placeholder="搜索项目" />
          </div>
          {projectCards.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
              {projectCards.map((project) => (
                <Link key={project.id} href={`/legacy/canvas?projectId=${project.id}`} className="w-fit">
                  <ProjectCard
                    title={project.title}
                    meta={`${project.laneCount} 个分镜 · 本地项目`}
                    status={project.status}
                  />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex justify-center py-10">
              <EmptyState
                icon={Film}
                title="还没有项目"
                description="粘贴一段文字稿，开始创作"
                action={<NewProjectDialog />}
              />
            </div>
          )}
        </section>

        {projectCards.length > 0 && (
          <section className="px-4 pb-12 sm:px-10 lg:px-20">
            <h2 className="mb-3 text-[13px] font-semibold text-label-secondary">最近渲染</h2>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {projectCards.slice(0, 4).map((project) => (
                <Link key={project.id} href={`/legacy/canvas?projectId=${project.id}`} className="shrink-0">
                  <ProjectCard
                    title={project.title}
                    meta={`${project.laneCount} 个分镜 · 本地项目`}
                    status={project.status}
                    className="w-50"
                  />
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  )
}
