import { notFound } from 'next/navigation'
import { withPageSession } from '@/features/auth/page-session'
import { getCanvasGraph, listProjects } from '@/features/canvas'
import { getProjectRouteState } from '@/features/projects/project-compatibility'
import { getProjectExecutionSnapshot } from '@/features/projects'
import { UnsupportedProjectNotice } from '@/features/canvas/unsupported-project-notice'
import { ExportWorkspace } from './export-workspace'
import { WebsiteExportWorkspace } from './website-export-workspace'

export const dynamic = 'force-dynamic'

export default async function ExportPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return withPageSession(`/products/export/${projectId}`, () =>
    renderExport(projectId),
  )
}

async function renderExport(projectId: string) {
  const routeState = await getProjectRouteState(projectId)
  if (routeState === 'missing') notFound()
  if (routeState === 'legacy') return <UnsupportedProjectNotice />
  const project = (await listProjects()).find(
    (candidate) => candidate.id === projectId
  )
  if (!project) notFound()
  if (project.kind === 'website') {
    const initialExecution = await getProjectExecutionSnapshot(projectId)
    return (
      <WebsiteExportWorkspace
        initialExecution={initialExecution}
        projectId={projectId}
        projectTitle={project.title}
      />
    )
  }
  const renderNodes = (await getCanvasGraph(projectId)).nodes
    .filter((node) => node.type === 'shot-codegen' && node.laneKey)
    .sort((left, right) => left.laneKey!.localeCompare(right.laneKey!))
  return (
    <ExportWorkspace
      projectId={projectId}
      projectTitle={project.title}
      laneKeys={renderNodes.map((node) => node.laneKey!)}
      rendererNodeId={renderNodes[0]?.id}
    />
  )
}
