import 'server-only'
import {
  getCanvasGraph,
  invalidateNodeForRegeneration,
} from '@/features/canvas'
import { enqueueRenderShot } from '@/features/render'
import { getDb } from '@/lib/db/client'
import { storage } from '@/lib/storage'
import { requestExportFinalization } from './export-finalization'
import { enqueueDirectorStage } from './queue-handler'
import type { NodeRecoveryDependencies } from './recovery'
import { DirectorArtifactSource } from './runtime-artifact-source'
import { enableProjectAutomaticAdvance } from './automatic-advance-control'

export async function createRecoveryDependencies(): Promise<NodeRecoveryDependencies> {
  const database = await getDb()
  const source = new DirectorArtifactSource(database, storage)
  return {
    getGraph: getCanvasGraph,
    enableAutomaticAdvance: (projectId) =>
      enableProjectAutomaticAdvance(projectId, database),
    inspectShotSpec: async (projectId, laneKey, sourceUnitId) => {
      const shotPlan = await source.loadShotSpecArtifact(projectId, laneKey)
      if (shotPlan.shots.length !== 1) return false
      const [shot] = shotPlan.shots
      if (!shot || shot.id !== laneKey) return false
      if (!sourceUnitId) return true
      const sourceUnitIds = Array.isArray(shot.sourceUnitIds)
        ? shot.sourceUnitIds
        : []
      const audioBinding =
        shot.audioBinding &&
        typeof shot.audioBinding === 'object' &&
        !Array.isArray(shot.audioBinding)
          ? shot.audioBinding as Record<string, unknown>
          : null
      return (
        sourceUnitIds.length === 1 &&
        sourceUnitIds[0] === sourceUnitId &&
        audioBinding?.unitId === sourceUnitId
      )
    },
    invalidate: invalidateNodeForRegeneration,
    enqueueDirectorStage,
    enqueueRenderShot,
    requestExportFinalization,
  }
}
