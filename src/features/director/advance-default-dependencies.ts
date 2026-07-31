import { getDb } from '@/lib/db/client'
import { withProjectResumeControl } from './resume-control'
import { AdvanceRepositoryImpl } from './advance-repository'
import type {
  AdvanceDependencies,
  AdvanceResult,
  PipelineControlDependencies,
  PipelineRepository,
} from './advance'

type AdvancePipeline = (
  projectId: string,
  completedNodeId: string,
  dependencies: AdvanceDependencies,
) => Promise<AdvanceResult>

export async function createDefaultAdvanceDependencies(): Promise<AdvanceDependencies> {
  const [
    { enqueueDirectorStageWithReceipt },
    { enqueueRenderShot },
    { requestExportFinalization },
  ] = await Promise.all([
    import('./queue-handler'),
    import('@/features/render/queue-handler'),
    import('./export-finalization'),
  ])
  return {
    repository: new AdvanceRepositoryImpl(await getDb()),
    enqueueDirectorStage: (input, options) =>
      enqueueDirectorStageWithReceipt(input, undefined, options),
    enqueueRenderShot: (input, options) =>
      enqueueRenderShot(input, undefined, options),
    requestExportFinalization,
  }
}

export async function createDefaultPipelineControlDependencies(
  advancePipeline: AdvancePipeline,
): Promise<PipelineControlDependencies> {
  const { repairProjectFrontier } = await import('./recovery')
  const advanceDependencies = await createDefaultAdvanceDependencies()
  const repository = advanceDependencies.repository as PipelineRepository
  return {
    repository,
    enqueueDirectorStage: advanceDependencies.enqueueDirectorStage,
    repairFrontier: repairProjectFrontier,
    withResumeControl: (projectId, execution, operation) =>
      withProjectResumeControl(projectId, execution, operation),
    advance: (projectId, completedNodeId) =>
      advancePipeline(projectId, completedNodeId, advanceDependencies),
  }
}
