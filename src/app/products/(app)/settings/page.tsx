import { notFound } from 'next/navigation'
import { getCanvasGraph, listProjects } from '@/features/canvas'
import { getProjectRouteState } from '@/features/projects/project-compatibility'
import { UnsupportedProjectNotice } from '@/features/canvas/unsupported-project-notice'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>
}) {
  const { projectId } = await searchParams
  if (projectId) {
    const routeState = await getProjectRouteState(projectId)
    if (routeState === 'missing') notFound()
    if (routeState === 'legacy') return <UnsupportedProjectNotice />
    const projects = await listProjects()
    if (!projects.some((project) => project.id === projectId)) notFound()
  }
  const rendererNodeId = projectId
    ? (await getCanvasGraph(projectId)).nodes.find(
        (node) => node.type === 'shot-codegen'
      )?.id
    : undefined
  return <SettingsForm projectId={projectId} rendererNodeId={rendererNodeId} />
}
