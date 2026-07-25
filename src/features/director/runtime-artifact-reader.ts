import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import type { StorageAdapter } from '@/lib/storage'
import { DirectorArtifactSource } from './runtime-artifact-source'
import type { AudioAllocation, ShotAllocation } from './schemas/ingest'
import type { DirectorShot } from './schemas/director-shot-plan'
import type { PipelineStage } from './types'

export interface StageContextRow {
  projectTitle: string
  projectScript: string
  nodeProjectId: string
  nodeStage: string
  status: string
  data: unknown
  nodeType: string
  laneKey: string | null
}

export class DirectorArtifactReader {
  private readonly source: DirectorArtifactSource

  constructor(database: Db, storage: StorageAdapter) {
    this.source = new DirectorArtifactSource(database, storage)
  }

  async resolveDirectorInput(
    row: StageContextRow,
    stage: PipelineStage
  ): Promise<unknown> {
    if (stage === 'INGEST') {
      const payload = readPayload(row.data)
      return payload.directorInput ?? { rawScript: row.projectScript }
    }
    if (stage === 'DIRECT') {
      const ingest = await this.source.loadIngestArtifact(row.nodeProjectId)
      return {
        projectTitle: row.projectTitle,
        scriptUnits: ingest.scriptUnits,
        audioManifest: ingest.audioManifest,
        audioAllocation: ingest.audioAllocation,
      }
    }
    if (stage === 'SHOT_SPEC') return this.resolveShotSpecInput(row)
    if (stage === 'FABRICATE') return this.resolveFabricateInput(row)
    if (stage === 'ASSEMBLE') return this.resolveAssembleInput(row)
    if (stage === 'FINALIZE') return this.resolveFinalizeInput(row)
    throw new Error(`未处理的 Director stage：${stage}`)
  }

  private async resolveShotSpecInput(row: StageContextRow): Promise<unknown> {
    const [ingest, direct] = await Promise.all([
      this.source.loadIngestArtifact(row.nodeProjectId),
      this.source.loadDirectArtifact(row.nodeProjectId),
    ])
    return {
      scriptUnits: ingest.scriptUnits,
      audioAllocation: ingest.audioAllocation,
      masterPlan: direct.masterPlan,
      styleBible: direct.styleBible,
    }
  }

  private async resolveFabricateInput(row: StageContextRow): Promise<unknown> {
    if (!row.laneKey) throw new Error('FABRICATE 节点缺少 laneKey')
    const [ingest, direct, shot] = await Promise.all([
      this.source.loadIngestArtifact(row.nodeProjectId),
      this.source.loadDirectArtifact(row.nodeProjectId),
      this.loadShot(row.nodeProjectId, row.laneKey),
    ])
    return {
      shot,
      audioAllocation: ingest.audioAllocation,
      styleBible: direct.styleBible,
    }
  }

  private async resolveAssembleInput(row: StageContextRow): Promise<unknown> {
    const direct = await this.source.loadDirectArtifact(row.nodeProjectId)
    if (row.nodeType === 'score') {
      const [ingest, shotPlan, rendered] = await Promise.all([
        this.source.loadIngestArtifact(row.nodeProjectId),
        this.source.loadAllShotSpecs(row.nodeProjectId),
        this.source.loadAllRenderedArtifactKeys(row.nodeProjectId),
      ])
      return {
        styleBible: direct.styleBible,
        shotPlan,
        audioAllocation: ingest.audioAllocation,
        renderedArtifactKeys: rendered.map((item) => item.storageKey),
      }
    }
    if (row.nodeType !== 'shot-sfx' && row.nodeType !== 'shot-subtitle') {
      throw new Error(`未知 ASSEMBLE 节点类型：${row.nodeType}`)
    }
    if (!row.laneKey) throw new Error(`${row.nodeType} 节点缺少 laneKey`)
    const [ingest, shot] = await Promise.all([
      this.source.loadIngestArtifact(row.nodeProjectId),
      this.loadShot(row.nodeProjectId, row.laneKey),
    ])
    const shotAllocation = requireShotAllocation(
      ingest.audioAllocation,
      row.laneKey
    )
    const scriptUnit = ingest.scriptUnits.find(
      (unit) => unit.unitId === shotAllocation.audioUnitId
    )
    if (!scriptUnit) {
      throw new Error(`script units 中找不到 ${shotAllocation.audioUnitId}`)
    }
    if (row.nodeType === 'shot-sfx') {
      return {
        shot,
        scriptUnit,
        shotAllocation,
        renderedArtifactKey: await this.source.loadRenderedArtifactKey(
          row.nodeProjectId,
          row.laneKey
        ),
        styleBible: direct.styleBible,
      }
    }
    return { shot, scriptUnit, shotAllocation }
  }

  private async resolveFinalizeInput(row: StageContextRow): Promise<unknown> {
    if (row.nodeType === 'export') {
      const [shotPlan, draftArtifactKey, qaFindings] = await Promise.all([
        this.source.loadAllShotSpecs(row.nodeProjectId),
        this.source.loadFinalExportArtifact(row.nodeProjectId),
        this.source.loadShotQaFindings(row.nodeProjectId),
      ])
      return { shotPlan, draftArtifactKey, qaFindings }
    }
    if (row.nodeType !== 'shot-qa') {
      throw new Error(`未知 FINALIZE 节点类型：${row.nodeType}`)
    }
    if (!row.laneKey) throw new Error('shot-qa 节点缺少 laneKey')
    const [ingest, shot, renderedArtifactKey] = await Promise.all([
      this.source.loadIngestArtifact(row.nodeProjectId),
      this.loadShot(row.nodeProjectId, row.laneKey),
      this.source.loadRenderedArtifactKey(row.nodeProjectId, row.laneKey),
    ])
    return {
      shot,
      renderedArtifactKey,
      shotAllocation: requireShotAllocation(ingest.audioAllocation, row.laneKey),
    }
  }

  private async loadShot(
    projectId: string,
    laneKey: string
  ): Promise<DirectorShot> {
    const shotPlan = await this.source.loadShotSpecArtifact(projectId, laneKey)
    const shot = shotPlan.shots.find((item) => item.id === laneKey)
    if (!shot) throw new Error(`shot plan 中找不到 ${laneKey}`)
    return shot
  }
}

function requireShotAllocation(
  audioAllocation: AudioAllocation,
  laneKey: string
): ShotAllocation {
  const allocation = audioAllocation.shots.find((item) => item.id === laneKey)
  if (!allocation) throw new Error(`audio allocation 中找不到 ${laneKey}`)
  return allocation
}

function readPayload(data: unknown): Record<string, unknown> {
  return z
    .object({
      schemaVersion: z.number(),
      payload: z.record(z.string(), z.unknown()),
    })
    .parse(data).payload
}
