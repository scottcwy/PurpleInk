import { getCanvasGraph } from '@/features/canvas'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>
}) {
  const { projectId } = await searchParams
  const rendererNodeId = projectId
    ? (await getCanvasGraph(projectId)).nodes.find(
        (node) => node.type === 'shot-codegen'
      )?.id
    : undefined
  return <SettingsForm projectId={projectId} rendererNodeId={rendererNodeId} />
}
