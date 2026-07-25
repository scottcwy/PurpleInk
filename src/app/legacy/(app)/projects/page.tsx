import Link from 'next/link'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { getCanvasGraph, listProjects } from '@/features/canvas'
import { PublishNavContext } from '@/features/navigation/nav-context'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const projects = await listProjects()
  const activeProject = projects[0]
  const rendererNodeId = activeProject
    ? (await getCanvasGraph(activeProject.id)).nodes.find(
        (node) => node.type === 'shot-codegen'
      )?.id
    : undefined
  return (
    <>
      <PublishNavContext projectId={activeProject?.id} rendererNodeId={rendererNodeId} />
      <main className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-y-auto p-8">
        <h1 className="text-2xl font-bold">项目列表</h1>
        <p className="mt-2 text-sm text-label-secondary">共 {projects.length} 个项目。</p>

        {projects.length === 0 ? (
          <p className="mt-6 text-sm text-label-tertiary">还没有项目</p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <Link key={project.id} href={`/legacy/canvas?projectId=${project.id}`}>
                <Card>
                  <CardTitle>{project.title}</CardTitle>
                  <CardBody>{new Date(project.updatedAt).toLocaleString('zh-CN')}</CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-6">
          <Link href="/legacy" className="text-sm text-label-secondary underline">
            返回工作台
          </Link>
        </div>
      </main>
    </>
  )
}
